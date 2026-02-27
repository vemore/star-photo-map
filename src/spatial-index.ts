/**
 * Grid-based spatial hash for fast nearest-neighbor lookups in 2D projection space.
 * Items are stored in fixed-size cells. Queries check only nearby cells.
 */
export class SpatialIndex<T> {
  private cells = new Map<string, { item: T; x: number; y: number }[]>();
  private cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private cellCoord(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  clear() {
    this.cells.clear();
  }

  insert(item: T, x: number, y: number) {
    const cx = this.cellCoord(x);
    const cy = this.cellCoord(y);
    const k = this.key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push({ item, x, y });
  }

  /**
   * Find the closest item within `radius` of (qx, qy).
   * Returns null if nothing is within range.
   */
  findNearest(qx: number, qy: number, radius: number): T | null {
    const minCx = this.cellCoord(qx - radius);
    const maxCx = this.cellCoord(qx + radius);
    const minCy = this.cellCoord(qy - radius);
    const maxCy = this.cellCoord(qy + radius);

    let best: T | null = null;
    let bestDist = radius * radius;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const entry of bucket) {
          const dx = entry.x - qx;
          const dy = entry.y - qy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) {
            bestDist = d2;
            best = entry.item;
          }
        }
      }
    }

    return best;
  }
}
