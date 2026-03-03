import type { DSO, DSOType } from './types';
import { getLang } from './i18n';

let dsos: DSO[] = [];
const dsoById = new Map<string, DSO>();

function angularDistance(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const toRad = Math.PI / 180;
  const d1 = dec1 * toRad;
  const d2 = dec2 * toRad;
  const dra = (ra2 - ra1) * toRad;
  const cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dra);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / toRad;
}

export async function loadDSOCatalog(): Promise<void> {
  const json = await fetch('/data/dso.json').then(r => r.json());

  const fields: string[] = json.fields;
  const idxId       = fields.indexOf('id');
  const idxRa       = fields.indexOf('ra');
  const idxDec      = fields.indexOf('dec');
  const idxType     = fields.indexOf('type');
  const idxMajAxis  = fields.indexOf('majAxis');
  const idxMinAxis  = fields.indexOf('minAxis');
  const idxPa       = fields.indexOf('pa');
  const idxMag      = fields.indexOf('mag');
  const idxNameFr   = fields.indexOf('nameFr');
  const idxNameEn   = fields.indexOf('nameEn');

  const lang = getLang();

  for (const row of json.data) {
    const nameFr: string | null = row[idxNameFr];
    const nameEn: string | null = idxNameEn >= 0 ? row[idxNameEn] : null;
    const displayName = lang === 'fr' ? nameFr : (nameEn || nameFr);

    const dso: DSO = {
      id:      row[idxId],
      ra:      row[idxRa],
      dec:     row[idxDec],
      type:    row[idxType] as DSOType,
      majAxis: row[idxMajAxis],
      minAxis: row[idxMinAxis],
      pa:      row[idxPa] ?? 0,
      mag:     row[idxMag],
      displayName,
    };
    dsos.push(dso);

    // Index by canonical ID (uppercase)
    dsoById.set(dso.id.toUpperCase(), dso);

    // Cross-reference: M31 → also accessible as NGC224
    // (the data already has primary Messier IDs; NGC cross-refs handled by direct search)
  }

  // Already sorted by magnitude in the JSON (brightest first)
}

export function getDSOs(): DSO[] {
  return dsos;
}

export function getDSOById(id: string): DSO | undefined {
  return dsoById.get(id.toUpperCase());
}

export type DSOCatalog = 'M' | 'NGC' | 'IC' | 'SH2';

export function getDSOCatalog(id: string): DSOCatalog | null {
  if (/^M\d/.test(id)) return 'M';
  if (id.startsWith('NGC')) return 'NGC';
  if (id.startsWith('IC')) return 'IC';
  if (id.startsWith('SH2')) return 'SH2';
  return null;
}

export function getDSOsNear(ra: number, dec: number, radiusDeg: number): DSO[] {
  // First pass: bounding box filter
  const decMin = dec - radiusDeg;
  const decMax = dec + radiusDeg;
  const result: DSO[] = [];

  for (const dso of dsos) {
    if (dso.dec < decMin || dso.dec > decMax) continue;
    if (angularDistance(ra, dec, dso.ra, dso.dec) <= radiusDeg) {
      result.push(dso);
    }
  }

  return result;
}
