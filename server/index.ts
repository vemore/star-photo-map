import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createPhoto, getAllPhotos, deletePhoto, getPhotoFilename } from './db.js';
import { extractWCS, wcsToCorrespondences, loadServerCatalog } from './wcs-reader.js';
import { submitJob, getJobStatus, isConfigured as isAstrometryConfigured } from './astrometry.js';
import { isASTAPInstalled, solveWithASTAP } from './astap.js';
import { searchDeepStars, getDeepStarByHip } from './star-search.js';

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
    if (!Array.isArray(correspondences) || correspondences.length < 3) {
      res.status(400).json({ error: 'Au moins 3 correspondances requises' });
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

// --- WCS solve route ---
app.post('/api/solve-wcs', upload.single('photo'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: 'Aucun fichier fourni' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.tif', '.tiff', '.fits', '.fit'].includes(ext)) {
      res.status(400).json({ success: false, error: 'Format non supporté. Utilisez TIFF ou FITS.' });
      return;
    }

    const wcs = extractWCS(file.buffer, ext);
    if (!wcs) {
      res.json({ success: false, error: 'Aucune donnée WCS trouvée dans le fichier' });
      return;
    }

    // Get image dimensions
    let imageWidth = wcs.NAXIS1;
    let imageHeight = wcs.NAXIS2;

    // For TIFF, try to get dimensions from sharp if NAXIS not in header
    if ((ext === '.tif' || ext === '.tiff') && (!imageWidth || !imageHeight)) {
      try {
        const metadata = await sharp(file.buffer).metadata();
        imageWidth = metadata.width || imageWidth;
        imageHeight = metadata.height || imageHeight;
      } catch {
        // Ignore sharp errors
      }
    }

    if (!imageWidth || !imageHeight) {
      res.json({ success: false, error: 'Dimensions de l\'image introuvables' });
      return;
    }

    loadServerCatalog();
    const correspondences = wcsToCorrespondences(wcs, imageWidth, imageHeight);

    if (correspondences.length < 3) {
      res.json({ success: false, error: 'Pas assez d\'étoiles du catalogue dans le champ' });
      return;
    }

    res.json({ success: true, correspondences });
  } catch (err: any) {
    console.error('WCS solve error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- ASTAP local plate solve route ---
app.post('/api/solve-astap', upload.single('photo'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Fichier manquant' });
    return;
  }
  if (!isASTAPInstalled()) {
    res.status(400).json({ error: 'ASTAP non installé (définir ASTAP_PATH)' });
    return;
  }

  try {
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const meta = await sharp(req.file.buffer).metadata();
    const result = await solveWithASTAP(req.file.buffer, ext, meta.width ?? 0, meta.height ?? 0);
    res.json(result);
  } catch (err: any) {
    console.error('ASTAP solve error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Astrometry.net plate solve routes ---
app.post('/api/solve-plate', upload.single('photo'), async (req, res) => {
  try {
    if (!isAstrometryConfigured()) {
      res.status(400).json({ error: 'ASTROMETRY_API_KEY non configurée sur le serveur' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }

    // Get image dimensions for calibration conversion later
    let imageWidth = 0;
    let imageHeight = 0;
    try {
      const metadata = await sharp(file.buffer).metadata();
      imageWidth = metadata.width || 0;
      imageHeight = metadata.height || 0;
    } catch {
      // For non-image formats, try to extract from FITS header
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.fits' || ext === '.fit') {
        const wcs = extractWCS(file.buffer, ext);
        if (wcs) {
          imageWidth = wcs.NAXIS1;
          imageHeight = wcs.NAXIS2;
        }
      }
    }

    if (!imageWidth || !imageHeight) {
      res.status(400).json({ error: 'Impossible de déterminer les dimensions de l\'image' });
      return;
    }

    const jobId = await submitJob(file.buffer, file.originalname, imageWidth, imageHeight);
    res.json({ jobId });
  } catch (err: any) {
    console.error('Plate solve submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/solve-plate/:id', (req, res) => {
  const job = getJobStatus(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job introuvable' });
    return;
  }

  res.json({
    jobId: job.localId,
    status: job.status,
    correspondences: job.correspondences,
    error: job.error,
  });
});

// --- Star search API ---
app.get('/api/stars/search', (req, res) => {
  try {
    const q = String(req.query.q || '');
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10), 50);
    const results = searchDeepStars(q, limit);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stars/:hip', (req, res) => {
  try {
    const hip = parseInt(req.params.hip, 10);
    if (isNaN(hip)) {
      res.status(400).json({ error: 'HIP invalide' });
      return;
    }
    const star = getDeepStarByHip(hip);
    if (!star) {
      res.status(404).json({ error: 'Étoile introuvable' });
      return;
    }
    res.json(star);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback in production
if (fs.existsSync(DIST_DIR)) {
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
