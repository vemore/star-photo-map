import type { DetectedSpot, PlateSolveResult, PhotoCorrespondence, Star } from './types';
import { getStars } from './star-catalog';
import { project } from './projection';
import { t } from './i18n';

const DEG2RAD = Math.PI / 180;
const BIN_SIZE = 0.002;

interface IndexTriangle {
  stars: [Star, Star, Star];
  dists: [number, number, number]; // sorted ascending
}

// Lazy-initialized index
let triangleIndex: Map<number, IndexTriangle[]> | null = null;
let indexStars: Star[] | null = null;

/**
 * Build the triangle hash index from catalog stars with mag < 5.5.
 */
function buildIndex(): void {
  const allStars = getStars();
  indexStars = allStars.filter(s => s.mag < 5.5);

  // Precompute unit vectors on the celestial sphere
  const vectors = indexStars.map(s => {
    const raRad = s.ra * DEG2RAD;
    const decRad = s.dec * DEG2RAD;
    return {
      star: s,
      x: Math.cos(decRad) * Math.cos(raRad),
      y: Math.cos(decRad) * Math.sin(raRad),
      z: Math.sin(decRad),
    };
  });

  triangleIndex = new Map();
  const maxAngDist = 15 * DEG2RAD; // 15 degrees max separation

  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const dotIJ = vectors[i].x * vectors[j].x + vectors[i].y * vectors[j].y + vectors[i].z * vectors[j].z;
      if (dotIJ < Math.cos(maxAngDist)) continue; // too far apart
      const distIJ = Math.acos(Math.min(1, Math.max(-1, dotIJ)));

      for (let k = j + 1; k < vectors.length; k++) {
        const dotIK = vectors[i].x * vectors[k].x + vectors[i].y * vectors[k].y + vectors[i].z * vectors[k].z;
        if (dotIK < Math.cos(maxAngDist)) continue;

        const dotJK = vectors[j].x * vectors[k].x + vectors[j].y * vectors[k].y + vectors[j].z * vectors[k].z;
        if (dotJK < Math.cos(maxAngDist)) continue;

        const distIK = Math.acos(Math.min(1, Math.max(-1, dotIK)));
        const distJK = Math.acos(Math.min(1, Math.max(-1, dotJK)));

        // Sort distances
        const dists = [distIJ, distIK, distJK].sort((a, b) => a - b) as [number, number, number];
        const dMax = dists[2];
        if (dMax < 0.5 * DEG2RAD) continue; // too small

        const r1 = dists[0] / dMax;
        const r2 = dists[1] / dMax;

        const key = quantize(r1, r2);
        const tri: IndexTriangle = {
          stars: [vectors[i].star, vectors[j].star, vectors[k].star],
          dists,
        };

        let bucket = triangleIndex.get(key);
        if (!bucket) {
          bucket = [];
          triangleIndex.set(key, bucket);
        }
        bucket.push(tri);
      }
    }
  }
}

function quantize(r1: number, r2: number): number {
  const b1 = Math.round(r1 / BIN_SIZE);
  const b2 = Math.round(r2 / BIN_SIZE);
  return b1 * 10000 + b2;
}

/**
 * Compute pixel distance between two spots.
 */
function pixDist(a: DetectedSpot, b: DetectedSpot): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Solve plate: match detected spots to catalog stars.
 */
interface MatchResult {
  correspondences: PhotoCorrespondence[];
  verified: number;
}

function findBestMatch(
  spots: DetectedSpot[],
  imageWidth: number,
  imageHeight: number,
): MatchResult | null {
  const topSpots = spots.slice(0, 10);
  const n = topSpots.length;
  let bestMatch: MatchResult | null = null;

  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        const dIJ = pixDist(topSpots[i], topSpots[j]);
        const dIK = pixDist(topSpots[i], topSpots[k]);
        const dJK = pixDist(topSpots[j], topSpots[k]);

        const pixDists = [
          { d: dIJ, spots: [i, j] },
          { d: dIK, spots: [i, k] },
          { d: dJK, spots: [j, k] },
        ].sort((a, b) => a.d - b.d);

        const dMax = pixDists[2].d;
        if (dMax < 10) continue;

        const r1 = pixDists[0].d / dMax;
        const r2 = pixDists[1].d / dMax;

        const candidates: IndexTriangle[] = [];
        for (let dr1 = -1; dr1 <= 1; dr1++) {
          for (let dr2 = -1; dr2 <= 1; dr2++) {
            const b1 = Math.round(r1 / BIN_SIZE) + dr1;
            const b2 = Math.round(r2 / BIN_SIZE) + dr2;
            const key = b1 * 10000 + b2;
            const bucket = triangleIndex!.get(key);
            if (bucket) candidates.push(...bucket);
          }
        }

        if (candidates.length === 0) continue;

        for (const catTri of candidates) {
          const spotIndices = [i, j, k];
          const catStars = catTri.stars;
          const perms = generatePerms(spotIndices);

          for (const perm of perms) {
            const match = verifyMatch(perm, catStars, topSpots, spots, imageWidth, imageHeight);
            if (match && (!bestMatch || match.verified > bestMatch.verified)) {
              bestMatch = match;
              if (match.verified >= 8) return bestMatch;
            }
          }
        }
      }
    }

    if (bestMatch) {
      const bm: MatchResult = bestMatch;
      if (bm.verified >= 5) return bm;
    }
  }

  return bestMatch;
}

export async function solvePlate(
  spots: DetectedSpot[],
  imageWidth: number,
  imageHeight: number,
): Promise<PlateSolveResult> {
  if (!triangleIndex) {
    buildIndex();
  }

  if (spots.length < 3) {
    return { success: false, error: t('errors.notEnoughStars') };
  }

  const bestMatch = findBestMatch(spots, imageWidth, imageHeight);

  if (bestMatch && bestMatch.verified >= 5) {
    return buildResult(bestMatch);
  }

  return { success: false, error: t('errors.noSolution') };
}

function buildResult(match: { correspondences: PhotoCorrespondence[]; verified: number }): PlateSolveResult {
  // Choose 3 well-separated correspondences (maximize triangle area)
  const corrs = match.correspondences;
  let bestArea = 0;
  let bestTriple: [number, number, number] = [0, 1, 2];

  for (let i = 0; i < corrs.length - 2; i++) {
    for (let j = i + 1; j < corrs.length - 1; j++) {
      for (let k = j + 1; k < corrs.length; k++) {
        const area = Math.abs(
          (corrs[j].photoX - corrs[i].photoX) * (corrs[k].photoY - corrs[i].photoY) -
          (corrs[k].photoX - corrs[i].photoX) * (corrs[j].photoY - corrs[i].photoY)
        ) / 2;
        if (area > bestArea) {
          bestArea = area;
          bestTriple = [i, j, k];
        }
      }
    }
  }

  const result = bestTriple.map((idx, pointIndex) => ({
    ...corrs[idx],
    pointIndex,
  }));

  return { success: true, correspondences: result };
}

/**
 * Verify a candidate star mapping by computing affine transform and checking all spots.
 */
function verifyMatch(
  spotIndices: number[],
  catStars: [Star, Star, Star],
  topSpots: DetectedSpot[],
  allSpots: DetectedSpot[],
  imageWidth: number,
  imageHeight: number,
): { correspondences: PhotoCorrespondence[]; verified: number } | null {
  // Compute affine transform from 3 spot↔star pairs
  // spot pixel → projection coords
  const photoPoints = spotIndices.map(si => ({ x: topSpots[si].x, y: topSpots[si].y }));
  const projPoints = catStars.map(s => project(s.ra, s.dec));

  // Solve affine: proj = M * photo
  const [p0, p1, p2] = photoPoints;
  const [c0, c1, c2] = projPoints;

  const det =
    p0.x * (p1.y - p2.y) -
    p0.y * (p1.x - p2.x) +
    (p1.x * p2.y - p2.x * p1.y);

  if (Math.abs(det) < 1e-10) return null;

  const invDet = 1 / det;
  const inv = [
    [(p1.y - p2.y) * invDet, (p2.y - p0.y) * invDet, (p0.y - p1.y) * invDet],
    [(p2.x - p1.x) * invDet, (p0.x - p2.x) * invDet, (p1.x - p0.x) * invDet],
    [
      (p1.x * p2.y - p2.x * p1.y) * invDet,
      (p2.x * p0.y - p0.x * p2.y) * invDet,
      (p0.x * p1.y - p1.x * p0.y) * invDet,
    ],
  ];

  const a = inv[0][0] * c0.x + inv[0][1] * c1.x + inv[0][2] * c2.x;
  const c = inv[1][0] * c0.x + inv[1][1] * c1.x + inv[1][2] * c2.x;
  const e = inv[2][0] * c0.x + inv[2][1] * c1.x + inv[2][2] * c2.x;
  const b = inv[0][0] * c0.y + inv[0][1] * c1.y + inv[0][2] * c2.y;
  const d = inv[1][0] * c0.y + inv[1][1] * c1.y + inv[1][2] * c2.y;
  const f = inv[2][0] * c0.y + inv[2][1] * c1.y + inv[2][2] * c2.y;

  // Sanity check: validate the implied plate scale (projection units per pixel).
  // For astrophotos scaled to ~1000px wide, the stereographic projection scale
  // near Dec 0° is ~0.01745 proj/°. Acceptable FOV range: 5 arcmin to 35°.
  //   5 arcmin  → (5/60)° × 0.01745 / 1000px ≈ 1.5e-6 proj/px
  //   35°        →   35°  × 0.01745 / 1000px ≈ 6.1e-4 proj/px
  const plateScale = Math.sqrt(a * a + b * b);
  if (plateScale < 1e-6 || plateScale > 8e-4) return null;

  // Now verify: transform all spots and find matching catalog stars
  const allCatalogStars = getStars().filter(s => s.mag < 8.0);
  const tolerance = 0.5 * DEG2RAD; // 0.5° tolerance for initial candidate search

  // Precompute projection coords for catalog stars
  const catProjected = allCatalogStars.map(s => ({
    star: s,
    proj: project(s.ra, s.dec),
  }));

  const correspondences: PhotoCorrespondence[] = [];
  const usedStars = new Set<number>();

  // Include the 3 anchor stars
  for (let m = 0; m < 3; m++) {
    correspondences.push({
      pointIndex: m,
      photoX: topSpots[spotIndices[m]].x,
      photoY: topSpots[spotIndices[m]].y,
      starHip: catStars[m].hip,
      starName: starLabel(catStars[m]),
    });
    usedStars.add(catStars[m].hip);
  }

  // Check remaining spots
  const spotsToCheck = allSpots.slice(0, 30);
  for (const spot of spotsToCheck) {
    // Skip if this is one of the anchor spots
    if (spotIndices.some(si => topSpots[si] === spot)) continue;

    // Transform spot to projection space
    const projX = a * spot.x + c * spot.y + e;
    const projY = b * spot.x + d * spot.y + f;

    // Find nearest catalog star
    let bestDist = tolerance;
    let bestStar: Star | null = null;

    for (const { star, proj } of catProjected) {
      if (usedStars.has(star.hip)) continue;
      const dx = proj.x - projX;
      const dy = proj.y - projY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Convert projection distance to approximate angular distance
      // Near the pole, projection distance ≈ angular distance in radians for small angles
      if (dist < bestDist) {
        bestDist = dist;
        bestStar = star;
      }
    }

    if (bestStar) {
      usedStars.add(bestStar.hip);
      correspondences.push({
        pointIndex: correspondences.length,
        photoX: spot.x,
        photoY: spot.y,
        starHip: bestStar.hip,
        starName: starLabel(bestStar),
      });
    }
  }

  if (correspondences.length >= 5) {
    return { correspondences, verified: correspondences.length };
  }

  return null;
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
  if (star.bayer && star.constellation) {
    return `${star.bayer} ${star.constellation}`;
  }
  return `HIP ${star.hip}`;
}

function generatePerms(arr: number[]): number[][] {
  const [a, b, c] = arr;
  return [
    [a, b, c],
    [a, c, b],
    [b, a, c],
    [b, c, a],
    [c, a, b],
    [c, b, a],
  ];
}
