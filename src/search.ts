import type { Star } from './types';
import { getNamedStars } from './star-catalog';

export interface SearchResult {
  star: Star;
  label: string;
  score: number;
}

export function searchStars(query: string, limit = 10): SearchResult[] {
  if (!query || query.length < 1) return [];

  const q = query.toLowerCase().trim();
  const results: SearchResult[] = [];

  for (const star of getNamedStars()) {
    let score = 0;
    let label = '';

    // Match by proper name
    if (star.name) {
      const n = star.name.toLowerCase();
      if (n === q) score = 100;
      else if (n.startsWith(q)) score = 80;
      else if (n.includes(q)) score = 60;

      if (score > 0) {
        label = star.name;
        if (star.bayer && star.constellation) {
          label += ` (${star.bayer} ${star.constellation})`;
        }
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
        label = star.constellation
          ? `${star.desig} ${star.constellation}`
          : star.desig;
        if (star.name) label = `${star.name} (${label})`;
      }
    }

    // Match by constellation
    if (score === 0 && star.constellation) {
      if (star.constellation.toLowerCase().startsWith(q)) {
        score = 20;
        label = star.name || star.desig || `HIP ${star.hip}`;
        label += ` (${star.constellation})`;
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
