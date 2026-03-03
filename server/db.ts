import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS star_correspondences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    point_index INTEGER NOT NULL,
    photo_x REAL NOT NULL,
    photo_y REAL NOT NULL,
    star_hip INTEGER NOT NULL,
    star_name TEXT,
    star_ra REAL,
    star_dec REAL,
    UNIQUE(photo_id, point_index)
  );

  CREATE INDEX IF NOT EXISTS idx_corr_photo_id ON star_correspondences(photo_id);
`);

// Migration: add star_ra/star_dec columns if missing
try {
  db.exec('ALTER TABLE star_correspondences ADD COLUMN star_ra REAL');
  db.exec('ALTER TABLE star_correspondences ADD COLUMN star_dec REAL');
} catch {
  // Columns already exist
}

const insertPhoto = db.prepare(
  'INSERT INTO photos (id, filename, original_name, width, height) VALUES (?, ?, ?, ?, ?)'
);
const insertCorrespondence = db.prepare(
  'INSERT INTO star_correspondences (photo_id, point_index, photo_x, photo_y, star_hip, star_name, star_ra, star_dec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const selectPhotos = db.prepare('SELECT * FROM photos ORDER BY created_at DESC');
const selectCorrespondences = db.prepare(
  'SELECT * FROM star_correspondences ORDER BY point_index'
);
const deletePhotoStmt = db.prepare('DELETE FROM photos WHERE id = ?');
const selectFilename = db.prepare('SELECT filename FROM photos WHERE id = ?');

interface CorrespondenceInput {
  pointIndex: number;
  photoX: number;
  photoY: number;
  starHip: number;
  starName: string;
  starRa?: number | null;
  starDec?: number | null;
}

export function createPhoto(
  id: string,
  filename: string,
  originalName: string,
  width: number,
  height: number,
  correspondences: CorrespondenceInput[],
) {
  const run = db.transaction(() => {
    insertPhoto.run(id, filename, originalName, width, height);
    for (const c of correspondences) {
      insertCorrespondence.run(id, c.pointIndex, c.photoX, c.photoY, c.starHip, c.starName, c.starRa ?? null, c.starDec ?? null);
    }
  });
  run();
}

export function getAllPhotos() {
  const photos = selectPhotos.all() as any[];
  const allCorr = selectCorrespondences.all() as any[];

  return photos.map(p => ({
    id: p.id,
    filename: p.filename,
    originalName: p.original_name,
    width: p.width,
    height: p.height,
    createdAt: p.created_at,
    correspondences: allCorr
      .filter(c => c.photo_id === p.id)
      .map(c => ({
        pointIndex: c.point_index,
        photoX: c.photo_x,
        photoY: c.photo_y,
        starHip: c.star_hip,
        starName: c.star_name,
        ...(c.star_ra != null ? { starRa: c.star_ra } : {}),
        ...(c.star_dec != null ? { starDec: c.star_dec } : {}),
      })),
  }));
}

export function deletePhoto(id: string): boolean {
  const result = deletePhotoStmt.run(id);
  return result.changes > 0;
}

export function getPhotoFilename(id: string): string | undefined {
  const row = selectFilename.get(id) as any;
  return row?.filename;
}
