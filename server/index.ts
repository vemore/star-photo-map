import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createPhoto, getAllPhotos, deletePhoto, getPhotoFilename } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const MAX_SIZE = 2048;

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// In production, serve the built frontend
const DIST_DIR = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
}

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

// Upload a photo with 3 star correspondences
app.post('/api/photos', upload.single('photo'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }

    const corrJson = req.body?.correspondences;
    if (!corrJson) {
      res.status(400).json({ error: 'Correspondances manquantes' });
      return;
    }

    const correspondences = JSON.parse(corrJson);
    if (!Array.isArray(correspondences) || correspondences.length !== 3) {
      res.status(400).json({ error: '3 correspondances requises' });
      return;
    }

    // Get original dimensions
    const metadata = await sharp(file.buffer).metadata();
    const origWidth = metadata.width!;
    const origHeight = metadata.height!;

    // Resize if needed (max 2048px on longest side)
    let resized = sharp(file.buffer);
    let newWidth = origWidth;
    let newHeight = origHeight;

    if (origWidth > MAX_SIZE || origHeight > MAX_SIZE) {
      if (origWidth >= origHeight) {
        newWidth = MAX_SIZE;
        newHeight = Math.round(origHeight * (MAX_SIZE / origWidth));
      } else {
        newHeight = MAX_SIZE;
        newWidth = Math.round(origWidth * (MAX_SIZE / origHeight));
      }
      resized = resized.resize(newWidth, newHeight);
    }

    // Save to disk
    const id = uuidv4();
    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `${id}${ext}`;
    await resized.toFile(path.join(UPLOADS_DIR, filename));

    // Scale correspondences to resized dimensions
    const scaleX = newWidth / origWidth;
    const scaleY = newHeight / origHeight;

    const scaledCorrespondences = correspondences.map((c: any) => ({
      pointIndex: c.pointIndex,
      photoX: c.photoX * scaleX,
      photoY: c.photoY * scaleY,
      starHip: c.starHip,
      starName: c.starName || '',
    }));

    // Store in database
    createPhoto(id, filename, file.originalname, newWidth, newHeight, scaledCorrespondences);

    res.json({
      id,
      filename,
      originalName: file.originalname,
      width: newWidth,
      height: newHeight,
      createdAt: new Date().toISOString(),
      correspondences: scaledCorrespondences,
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List all photos
app.get('/api/photos', (_req, res) => {
  try {
    const photos = getAllPhotos();
    res.json(photos);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a photo
app.delete('/api/photos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const filename = getPhotoFilename(id);

    if (!filename) {
      res.status(404).json({ error: 'Photo introuvable' });
      return;
    }

    // Delete file from disk
    const filePath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    deletePhoto(id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback in production
if (fs.existsSync(DIST_DIR)) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
