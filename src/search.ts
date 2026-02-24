import type { Star } from './types';
import { getStars, getStarByHip } from './star-catalog';

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
