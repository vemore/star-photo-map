import type { Point, ViewState } from './types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Stereographic polar projection: (RA°, Dec°) → projection (x, y).
 * North Celestial Pole at origin, equator at r=1.
 * RA increases clockwise (as seen from Earth looking up).
 */
export function project(raDeg: number, decDeg: number): Point {
  const raRad = raDeg * DEG2RAD;
  const r = Math.tan((90 - decDeg) / 2 * DEG2RAD);
  return {
    x: -r * Math.sin(raRad),
    y: r * Math.cos(raRad),
  };
}

/** Inverse projection: projection (x, y) → { ra°, dec° } */
export function unproject(x: number, y: number): { ra: number; dec: number } {
  const r = Math.sqrt(x * x + y * y);
  const dec = 90 - 2 * Math.atan(r) * RAD2DEG;
  let ra = Math.atan2(-x, y) * RAD2DEG;
  if (ra < 0) ra += 360;
  return { ra, dec };
}

/** Projection coordinates → canvas pixel coordinates */
export function toCanvas(px: number, py: number, view: ViewState): Point {
  return {
    x: view.width / 2 + (px - view.centerX) * view.scale,
    y: view.height / 2 - (py - view.centerY) * view.scale,
  };
}

/** Canvas pixel coordinates → projection coordinates */
export function fromCanvas(cx: number, cy: number, view: ViewState): Point {
  return {
    x: view.centerX + (cx - view.width / 2) / view.scale,
    y: view.centerY - (cy - view.height / 2) / view.scale,
  };
}
