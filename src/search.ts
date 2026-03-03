import type { Star, DSO, DSOSearchResult } from './types';
import { getStars, getStarByHip } from './star-catalog';
import { getDSOs } from './dso-catalog';
import { searchStarsAPI } from './api';
import type { StarSearchResult } from './api';
import { t } from './i18n';

export interface SearchResult {
  star: Star;
  label: string;
  score: number;
}

function starLabel(star: Star): string {
  if (star.name) {
    if (star.bayer && star.constellation) {
      return `${star.name} (${star.bayer} ${star.constellation})`;
    }
    return star.name;
  }
  if (star.desig && star.constellation) {
    return `${star.desig} ${star.constellation}`;
  }
  if (star.flam && star.constellation) {
    return `${star.flam} ${star.constellation}`;
  }
  return `HIP ${star.hip} (${star.constellation || '?'}, mag ${star.mag.toFixed(1)})`;
}

export function searchStars(query: string, limit = 10): SearchResult[] {
  if (!query || query.length < 1) return [];

  const q = query.toLowerCase().trim();

  // Direct HIP lookup: "hip 12345" or "HIP12345" or pure number
  const hipMatch = q.match(/^hip\s*(\d+)$/i) || q.match(/^(\d+)$/);
  if (hipMatch) {
    const hip = parseInt(hipMatch[1], 10);
    const star = getStarByHip(hip);
    if (star) {
      return [{ star, label: starLabel(star), score: 100 }];
    }
    return [];
  }

  const results: SearchResult[] = [];

  for (const star of getStars()) {
    let score = 0;
    let label = '';

    // Match by proper name
    if (star.name) {
      const n = star.name.toLowerCase();
      if (n === q) score = 100;
      else if (n.startsWith(q)) score = 80;
      else if (n.includes(q)) score = 60;

      if (score > 0) {
        label = starLabel(star);
      }
    }

    // Match by Bayer designation
    if (score === 0 && star.desig) {
      const d = star.desig.toLowerCase();
      const full = star.constellation
        ? `${star.desig} ${star.constellation}`.toLowerCase()
        : d;

      if (full.startsWith(q) || d.startsWith(q)) score = 50;
      else if (full.includes(q) || d.includes(q)) score = 30;

      if (score > 0) {
        label = starLabel(star);
      }
    }

    // Match by Flamsteed designation (e.g. "47 UMa")
    if (score === 0 && star.flam && star.constellation) {
      const flamFull = `${star.flam} ${star.constellation}`.toLowerCase();
      if (flamFull.startsWith(q)) score = 45;
      else if (flamFull.includes(q)) score = 25;

      if (score > 0) {
        label = starLabel(star);
      }
    }

    // Match by constellation
    if (score === 0 && star.constellation) {
      if (star.constellation.toLowerCase().startsWith(q)) {
        score = 20;
        label = starLabel(star);
      }
    }

    if (score > 0) {
      // Boost brighter stars
      score += Math.max(0, (6 - star.mag) * 2);
      results.push({ star, label, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function getDSOTypeName(type: string): string {
  return t(`dso.types.${type}`) || t('dso.object');
}

function dsoLabel(dso: DSO): string {
  const typeName = getDSOTypeName(dso.type);
  if (dso.displayName) {
    return `${dso.id} – ${dso.displayName}`;
  }
  return `${dso.id} (${typeName})`;
}

export function searchDSOs(query: string, limit = 10): DSOSearchResult[] {
  if (!query || query.length < 1) return [];

  const q = query.toLowerCase().trim();
  const results: DSOSearchResult[] = [];

  for (const dso of getDSOs()) {
    let score = 0;
    const idLower = dso.id.toLowerCase();
    const nameLower = dso.displayName ? dso.displayName.toLowerCase() : '';

    // 1. Exact ID match
    if (idLower === q) {
      score = 100;
    }
    // 2. ID prefix match
    else if (idLower.startsWith(q)) {
      score = 90;
    }
    // 3. Exact name match
    else if (nameLower && nameLower === q) {
      score = 80;
    }
    // 4. Name starts with query
    else if (nameLower && nameLower.startsWith(q)) {
      score = 65;
    }
    // 5. Name contains query
    else if (nameLower && nameLower.includes(q)) {
      score = 40;
    }
    // 6. Partial ID match (e.g. "ngc70" matches "NGC7000")
    else if (idLower.includes(q)) {
      score = 25;
    }

    if (score > 0) {
      // Brightness boost
      const mag = dso.mag ?? 14;
      score += Math.max(0, (10 - mag) * 1.5);
      results.push({ dso, label: dsoLabel(dso), score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export interface UnifiedSearchResult {
  type: 'star' | 'dso';
  label: string;
  score: number;
  mag: number;
  ra: number;
  dec: number;
  star?: StarSearchResult;
  dso?: DSO;
}

export async function searchUnified(query: string, limit = 15): Promise<UnifiedSearchResult[]> {
  if (!query || query.length < 1) return [];

  const [starResults, dsoResults] = await Promise.all([
    searchStarsAPI(query, 8),
    Promise.resolve(searchDSOs(query, 8)),
  ]);

  const results: UnifiedSearchResult[] = [];

  for (const s of starResults) {
    results.push({
      type: 'star',
      label: s.label,
      score: s.score,
      mag: s.mag,
      ra: s.ra,
      dec: s.dec,
      star: s,
    });
  }

  for (const d of dsoResults) {
    results.push({
      type: 'dso',
      label: d.label,
      score: d.score,
      mag: d.dso.mag ?? 99,
      ra: d.dso.ra,
      dec: d.dso.dec,
      dso: d.dso,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
