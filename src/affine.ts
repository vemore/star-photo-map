import type { AffineMatrix, Point } from './types';

/**
 * Compute affine transform from 3 point correspondences.
 * Maps photo pixel coords → canvas pixel coords.
 *
 * CSS matrix(a, b, c, d, e, f):
 *   newX = a·x + c·y + e
 *   newY = b·x + d·y + f
 */
export function computeAffineTransform(
  photoPoints: [Point, Point, Point],
  canvasPoints: [Point, Point, Point],
): AffineMatrix {
  const [p0, p1, p2] = photoPoints;
  const [c0, c1, c2] = canvasPoints;

  // Matrix A = [[px0, py0, 1], [px1, py1, 1], [px2, py2, 1]]
  const det =
    p0.x * (p1.y - p2.y) -
    p0.y * (p1.x - p2.x) +
    (p1.x * p2.y - p2.x * p1.y);

  if (Math.abs(det) < 1e-10) {
    throw new Error('Les points sont colinéaires');
  }

  const invDet = 1 / det;

  // Inverse of A (adjugate / det)
  const inv = [
    [(p1.y - p2.y) * invDet, (p2.y - p0.y) * invDet, (p0.y - p1.y) * invDet],
    [(p2.x - p1.x) * invDet, (p0.x - p2.x) * invDet, (p1.x - p0.x) * invDet],
    [
      (p1.x * p2.y - p2.x * p1.y) * invDet,
      (p2.x * p0.y - p0.x * p2.y) * invDet,
      (p0.x * p1.y - p1.x * p0.y) * invDet,
    ],
  ];

  // Solve for CSS matrix columns
  // [a, c, e] = inv · [c0.x, c1.x, c2.x]
  const a = inv[0][0] * c0.x + inv[0][1] * c1.x + inv[0][2] * c2.x;
  const c = inv[1][0] * c0.x + inv[1][1] * c1.x + inv[1][2] * c2.x;
  const e = inv[2][0] * c0.x + inv[2][1] * c1.x + inv[2][2] * c2.x;

  // [b, d, f] = inv · [c0.y, c1.y, c2.y]
  const b = inv[0][0] * c0.y + inv[0][1] * c1.y + inv[0][2] * c2.y;
  const d = inv[1][0] * c0.y + inv[1][1] * c1.y + inv[1][2] * c2.y;
  const f = inv[2][0] * c0.y + inv[2][1] * c1.y + inv[2][2] * c2.y;

  return { a, b, c, d, e, f };
}

export function affineToCSS(m: AffineMatrix): string {
  return `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`;
}
