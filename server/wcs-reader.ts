import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface WCSData {
  CRPIX1: number;
  CRPIX2: number;
  CRVAL1: number; // RA of reference point (degrees)
  CRVAL2: number; // Dec of reference point (degrees)
  CD1_1: number;
  CD1_2: number;
  CD2_1: number;
  CD2_2: number;
  NAXIS1: number;
  NAXIS2: number;
}

interface CatalogStar {
  hip: number;
  ra: number;
  dec: number;
  mag: number;
  name?: string;
  bayer?: string;
  constellation?: string;
}

interface Correspondence {
  pointIndex: number;
  photoX: number;
  photoY: number;
  starHip: number;
  starName: string;
}

// Server-side star catalog (loaded lazily)
let serverStars: CatalogStar[] | null = null;

function normalizeRA(ra: number): number {
  while (ra < 0) ra += 360;
  while (ra >= 360) ra -= 360;
  return ra;
}

export function loadServerCatalog(): CatalogStar[] {
  if (serverStars) return serverStars;

  const starsPath = path.join(__dirname, '..', 'public', 'data', 'stars.8.json');
  const namesPath = path.join(__dirname, '..', 'public', 'data', 'starnames.json');

  const starsData = JSON.parse(fs.readFileSync(starsPath, 'utf-8'));
  const namesData = JSON.parse(fs.readFileSync(namesPath, 'utf-8'));

  serverStars = [];
  for (const f of starsData.features) {
    const hip: number = f.id;
    const [ra, dec]: [number, number] = f.geometry.coordinates;
    const info = namesData[String(hip)];
    serverStars.push({
      hip,
      ra: normalizeRA(ra),
      dec,
      mag: f.properties.mag,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      constellation: info?.c || undefined,
    });
  }

  serverStars.sort((a, b) => a.mag - b.mag);
  return serverStars;
}

// --- FITS Header Parsing ---

export function parseFITSHeader(headerStr: string): Record<string, number | string | boolean> {
  const result: Record<string, number | string | boolean> = {};
  // FITS headers are 80-character records
  for (let i = 0; i < headerStr.length; i += 80) {
    const record = headerStr.substring(i, i + 80);
    if (record.startsWith('END')) break;

    const keyword = record.substring(0, 8).trim();
    if (!keyword || record[8] !== '=' || !record[9]) continue;

    let valueStr = record.substring(10, 80);
    // Remove inline comment (after /)
    const slashIdx = valueStr.indexOf('/');
    if (slashIdx >= 0) {
      // Check it's not inside a string
      const quoteCount = (valueStr.substring(0, slashIdx).match(/'/g) || []).length;
      if (quoteCount % 2 === 0) {
        valueStr = valueStr.substring(0, slashIdx);
      }
    }
    valueStr = valueStr.trim();

    if (valueStr === 'T') {
      result[keyword] = true;
    } else if (valueStr === 'F') {
      result[keyword] = false;
    } else if (valueStr.startsWith("'")) {
      // String value
      const endQuote = valueStr.indexOf("'", 1);
      result[keyword] = endQuote > 0 ? valueStr.substring(1, endQuote).trim() : valueStr.substring(1).trim();
    } else {
      const num = parseFloat(valueStr);
      if (!isNaN(num)) {
        result[keyword] = num;
      }
    }
  }
  return result;
}

// --- TIFF Tag 270 Extraction ---

export function extractFITSHeaderFromTIFF(buffer: Buffer): string | null {
  if (buffer.length < 8) return null;

  // Check byte order
  const bo = buffer.toString('ascii', 0, 2);
  const le = bo === 'II';
  if (!le && bo !== 'MM') return null;

  const readU16 = (off: number) => le ? buffer.readUInt16LE(off) : buffer.readUInt16BE(off);
  const readU32 = (off: number) => le ? buffer.readUInt32LE(off) : buffer.readUInt32BE(off);

  // Check magic number
  if (readU16(2) !== 42) return null;

  // Read IFD offset
  let ifdOffset = readU32(4);

  // Traverse IFDs (usually just one, but support chained)
  while (ifdOffset > 0 && ifdOffset < buffer.length - 2) {
    const numEntries = readU16(ifdOffset);
    let entryOffset = ifdOffset + 2;

    for (let i = 0; i < numEntries; i++) {
      if (entryOffset + 12 > buffer.length) break;

      const tag = readU16(entryOffset);
      if (tag === 270) { // ImageDescription
        const type = readU16(entryOffset + 2);
        const count = readU32(entryOffset + 4);

        if (type !== 2) { // Not ASCII
          entryOffset += 12;
          continue;
        }

        let dataOffset: number;
        if (count <= 4) {
          dataOffset = entryOffset + 8;
        } else {
          dataOffset = readU32(entryOffset + 8);
        }

        if (dataOffset + count > buffer.length) return null;
        const str = buffer.toString('ascii', dataOffset, dataOffset + count).replace(/\0/g, '');
        // Check if it looks like a FITS header (contains WCS keywords)
        if (str.includes('CRVAL1') || str.includes('CRPIX1') || str.includes('CD1_1')) {
          return str;
        }
        return str;
      }
      entryOffset += 12;
    }

    // Next IFD offset
    const nextIFDOff = entryOffset;
    if (nextIFDOff + 4 > buffer.length) break;
    ifdOffset = readU32(nextIFDOff);
    if (ifdOffset === 0) break;
  }

  return null;
}

// --- FITS File Header Extraction ---

export function extractFITSHeaderFromFITS(buffer: Buffer): string {
  // FITS header starts at byte 0, 80-char records, blocks of 2880 bytes
  let header = '';
  for (let block = 0; block * 2880 < buffer.length; block++) {
    const blockStart = block * 2880;
    const blockEnd = Math.min(blockStart + 2880, buffer.length);
    const blockStr = buffer.toString('ascii', blockStart, blockEnd);
    header += blockStr;

    // Check for END keyword
    for (let i = 0; i < blockStr.length; i += 80) {
      const record = blockStr.substring(i, i + 80);
      if (record.substring(0, 8).trim() === 'END') {
        return header;
      }
    }
  }
  return header;
}

// --- WCS → Correspondences ---

const DEG2RAD = Math.PI / 180;

function starDisplayLabel(star: CatalogStar): string {
  if (star.name) {
    if (star.bayer && star.constellation) {
      return `${star.name} (${star.bayer} ${star.constellation})`;
    }
    return star.name;
  }
  if (star.bayer && star.constellation) {
    return `${star.bayer} ${star.constellation}`;
  }
  return `HIP ${star.hip}`;
}

export function wcsToCorrespondences(
  wcs: WCSData,
  imageWidth: number,
  imageHeight: number,
): Correspondence[] {
  const catalog = loadServerCatalog();

  // Compute approximate field of view from CD matrix
  const pixscaleX = Math.sqrt(wcs.CD1_1 * wcs.CD1_1 + wcs.CD2_1 * wcs.CD2_1); // deg/pixel
  const pixscaleY = Math.sqrt(wcs.CD1_2 * wcs.CD1_2 + wcs.CD2_2 * wcs.CD2_2);
  const fovX = pixscaleX * imageWidth; // degrees
  const fovY = pixscaleY * imageHeight;
  const searchRadius = Math.max(fovX, fovY) * 0.7; // slightly less than diagonal/2

  const centerRA = wcs.CRVAL1;
  const centerDec = wcs.CRVAL2;

  // Find stars within the field of view
  const starsInField: CatalogStar[] = [];
  for (const star of catalog) {
    const dRA = (star.ra - centerRA) * Math.cos(centerDec * DEG2RAD);
    const dDec = star.dec - centerDec;
    const dist = Math.sqrt(dRA * dRA + dDec * dDec);
    if (dist < searchRadius) {
      starsInField.push(star);
    }
  }

  // Sort by brightness
  starsInField.sort((a, b) => a.mag - b.mag);

  // Invert the CD matrix to convert from sky to pixel
  const det = wcs.CD1_1 * wcs.CD2_2 - wcs.CD1_2 * wcs.CD2_1;
  if (Math.abs(det) < 1e-20) return [];

  const invCD = {
    a: wcs.CD2_2 / det,
    b: -wcs.CD1_2 / det,
    c: -wcs.CD2_1 / det,
    d: wcs.CD1_1 / det,
  };

  // Convert star RA/Dec to pixel coords using TAN projection
  const starsWithPixels: { star: CatalogStar; px: number; py: number }[] = [];

  for (const star of starsInField) {
    const raRad = star.ra * DEG2RAD;
    const decRad = star.dec * DEG2RAD;
    const ra0Rad = centerRA * DEG2RAD;
    const dec0Rad = centerDec * DEG2RAD;

    const sinDec = Math.sin(decRad);
    const cosDec = Math.cos(decRad);
    const sinDec0 = Math.sin(dec0Rad);
    const cosDec0 = Math.cos(dec0Rad);
    const cosDRA = Math.cos(raRad - ra0Rad);
    const sinDRA = Math.sin(raRad - ra0Rad);

    const denom = sinDec0 * sinDec + cosDec0 * cosDec * cosDRA;
    if (denom < 0.01) continue; // behind projection

    // Standard coordinates (gnomonic/TAN projection) in degrees
    const xi = (cosDec * sinDRA / denom) * (180 / Math.PI);
    const eta = ((cosDec0 * sinDec - sinDec0 * cosDec * cosDRA) / denom) * (180 / Math.PI);

    // Pixel coordinates via inverse CD matrix
    const dx = invCD.a * xi + invCD.b * eta;
    const dy = invCD.c * xi + invCD.d * eta;
    const px = wcs.CRPIX1 + dx;
    const py = wcs.CRPIX2 + dy;

    // Check bounds (with margin)
    if (px >= -50 && px <= imageWidth + 50 && py >= -50 && py <= imageHeight + 50) {
      starsWithPixels.push({ star, px, py });
    }
  }

  if (starsWithPixels.length < 3) return [];

  // Choose 3 well-separated bright stars forming the largest triangle
  const candidates = starsWithPixels.slice(0, 20); // top 20 brightest
  let bestArea = 0;
  let bestTriple: [number, number, number] = [0, 1, 2];

  for (let i = 0; i < candidates.length - 2; i++) {
    for (let j = i + 1; j < candidates.length - 1; j++) {
      for (let k = j + 1; k < candidates.length; k++) {
        const a = candidates[i], b = candidates[j], c = candidates[k];
        // Shoelace area
        const area = Math.abs(
          (b.px - a.px) * (c.py - a.py) - (c.px - a.px) * (b.py - a.py)
        ) / 2;
        if (area > bestArea) {
          bestArea = area;
          bestTriple = [i, j, k];
        }
      }
    }
  }

  return bestTriple.map((idx, pointIndex) => {
    const { star, px, py } = candidates[idx];
    return {
      pointIndex,
      photoX: px,
      photoY: py,
      starHip: star.hip,
      starName: starDisplayLabel(star),
    };
  });
}

export function extractWCS(buffer: Buffer, ext: string): WCSData | null {
  let headerStr: string | null = null;

  if (ext === '.fits' || ext === '.fit') {
    headerStr = extractFITSHeaderFromFITS(buffer);
  } else if (ext === '.tif' || ext === '.tiff') {
    headerStr = extractFITSHeaderFromTIFF(buffer);
  }

  if (!headerStr) return null;

  const parsed = parseFITSHeader(headerStr);

  // Check required WCS keywords
  const required = ['CRPIX1', 'CRPIX2', 'CRVAL1', 'CRVAL2', 'CD1_1', 'CD1_2', 'CD2_1', 'CD2_2'];
  for (const key of required) {
    if (typeof parsed[key] !== 'number') return null;
  }

  return {
    CRPIX1: parsed.CRPIX1 as number,
    CRPIX2: parsed.CRPIX2 as number,
    CRVAL1: parsed.CRVAL1 as number,
    CRVAL2: parsed.CRVAL2 as number,
    CD1_1: parsed.CD1_1 as number,
    CD1_2: parsed.CD1_2 as number,
    CD2_1: parsed.CD2_1 as number,
    CD2_2: parsed.CD2_2 as number,
    NAXIS1: (parsed.NAXIS1 as number) || 0,
    NAXIS2: (parsed.NAXIS2 as number) || 0,
  };
}
