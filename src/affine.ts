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

  // Relative singularity threshold based on input coordinate scale
  const scale = Math.max(
    Math.abs(p0.x), Math.abs(p0.y), Math.abs(p1.x), Math.abs(p1.y),
    Math.abs(p2.x), Math.abs(p2.y), 1,
  );
  if (Math.abs(det) < 1e-10 * scale * scale) {
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

  if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d) || !isFinite(e) || !isFinite(f)) {
    throw new Error('Transformation affine invalide');
  }

  return { a, b, c, d, e, f };
}

export function affineToCSS(m: AffineMatrix): string {
  return `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`;
}

/**
 * Least-squares affine fit for N ≥ 3 point pairs.
 * Falls back to the exact 3-point solver when N === 3.
 * Minimises sum of squared residuals over all N pairs.
 */
export function computeAffineLSQ(
  photoPoints: Point[],
  canvasPoints: Point[],
): AffineMatrix {
  const n = photoPoints.length;
  if (n < 3) throw new Error('Au moins 3 points requis');
  if (n === 3) {
    return computeAffineTransform(
      photoPoints as [Point, Point, Point],
      canvasPoints as [Point, Point, Point],
    );
  }

  // Normal equations for CSS affine: newX = a·px + c·py + e, newY = b·px + d·py + f
  // Build A^T·A (3×3) and solve two right-hand sides (for X and for Y).
  let s_xx = 0, s_xy = 0, s_x = 0;
  let s_yy = 0, s_y = 0;
  let s_xX = 0, s_yX = 0, s_X = 0;
  let s_xY = 0, s_yY = 0, s_Y = 0;

  for (let i = 0; i < n; i++) {
    const x = photoPoints[i].x, y = photoPoints[i].y;
    const X = canvasPoints[i].x, Y = canvasPoints[i].y;
    s_xx += x * x; s_xy += x * y; s_x += x;
    s_yy += y * y; s_y += y;
    s_xX += x * X; s_yX += y * X; s_X += X;
    s_xY += x * Y; s_yY += y * Y; s_Y += Y;
  }

  // M = [[s_xx, s_xy, s_x], [s_xy, s_yy, s_y], [s_x, s_y, n]]
  const m00 = s_xx, m01 = s_xy, m02 = s_x;
  const m10 = s_xy, m11 = s_yy, m12 = s_y;
  const m20 = s_x,  m21 = s_y,  m22 = n;

  const det =
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20);

  // Relative singularity threshold based on normal matrix scale
  const mScale = Math.max(Math.abs(m00), Math.abs(m11), m22, 1);
  if (Math.abs(det) < 1e-10 * mScale * mScale * mScale) {
    throw new Error('Points colinéaires');
  }

  // Solve M·x = rhs via Cramer's rule
  function cramer(r0: number, r1: number, r2: number): [number, number, number] {
    const d0 = r0 * (m11 * m22 - m12 * m21) - m01 * (r1 * m22 - m12 * r2) + m02 * (r1 * m21 - m11 * r2);
    const d1 = m00 * (r1 * m22 - m12 * r2) - r0 * (m10 * m22 - m12 * m20) + m02 * (m10 * r2 - r1 * m20);
    const d2 = m00 * (m11 * r2 - r1 * m21) - m01 * (m10 * r2 - r1 * m20) + r0 * (m10 * m21 - m11 * m20);
    return [d0 / det, d1 / det, d2 / det];
  }

  const [a, c, e] = cramer(s_xX, s_yX, s_X);
  const [b, d, f] = cramer(s_xY, s_yY, s_Y);

  if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d) || !isFinite(e) || !isFinite(f)) {
    throw new Error('Transformation affine invalide');
  }

  return { a, b, c, d, e, f };
}
