import type { Star, DSO, ViewState, Point } from './types';
import { project, toCanvas, fromCanvas, unproject } from './projection';
import { getStars, getConstellationLines, getConstellationInfos } from './star-catalog';
import { getDSOs } from './dso-catalog';

const DEG2RAD = Math.PI / 180;

function bvToRgb(bv: number): [number, number, number] {
  bv = Math.max(-0.4, Math.min(2.0, bv));

  let r: number, g: number, b: number;

  if (bv < 0) {
    const t = (bv + 0.4) / 0.4;
    r = 0.61 + 0.39 * t;
    g = 0.70 + 0.30 * t;
    b = 1.0;
  } else if (bv < 0.4) {
    const t = bv / 0.4;
    r = 1.0;
    g = 1.0 - 0.1 * t;
    b = 1.0 - 0.3 * t;
  } else if (bv < 0.8) {
    const t = (bv - 0.4) / 0.4;
    r = 1.0;
    g = 0.9 - 0.3 * t;
    b = 0.7 - 0.4 * t;
  } else if (bv < 1.2) {
    const t = (bv - 0.8) / 0.4;
    r = 1.0;
    g = 0.6 - 0.2 * t;
    b = 0.3 - 0.2 * t;
  } else {
    const t = Math.min((bv - 1.2) / 0.8, 1);
    r = 1.0 - 0.3 * t;
    g = 0.4 - 0.2 * t;
    b = 0.1;
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function starRadius(mag: number): number {
  return Math.max(0.5, 4 - mag * 0.6);
}

function computeMaxMag(scale: number): number {
  const raw = 6 + Math.log2(scale / 200);
  return Math.max(6, Math.min(11, raw));
}

// ─── DSO rendering helpers ──────────────────────────────────────────────────

/** Convert angular size (arcmin) to canvas pixels accounting for stereographic scale */
function angularSizeToCanvasPx(arcmin: number, decDeg: number, scale: number): number {
  const theta = (90 - decDeg) * Math.PI / 180;
  const cos2 = Math.cos(theta / 2) ** 2;
  const rad = (arcmin / 60) * Math.PI / 180;
  return (rad / (2 * cos2)) * scale;
}

/** Position angle (E of celestial north) → angle on canvas */
function dsoCanvasAngle(pa: number, raDeg: number): number {
  const raRad = raDeg * Math.PI / 180;
  const northAngle = Math.atan2(Math.cos(raRad), Math.sin(raRad));
  return northAngle - pa * Math.PI / 180;
}

export type StarHoverCallback = (star: Star | null, x: number, y: number) => void;
export type DSOHoverCallback = (dso: DSO | null, x: number, y: number) => void;
export type StarPickedCallback = (star: Star) => void;

export class SkyMap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private view: ViewState;
  private onViewChange: (() => void) | null = null;
  private onStarHover: StarHoverCallback | null = null;
  private onDSOHover: DSOHoverCallback | null = null;
  private showDSOs = true;
  private showStars = true;
  private showConstellationLines = true;
  private showConstellationNames = true;
  private maxMagOverride: number | null = null;
  private visibleDSOTypes: Set<string> = new Set(['Gx', 'OC', 'GC', 'EN', 'RN', 'PN', 'SNR', 'DN', '?']);
  private showGrid = true;
  private showStarLabels = true;
  private skyOpacity = 0.8;
  private backgroundOpacity = 1.0;
  private photoOutlines: { name: string; corners: Point[] }[] = [];
  private showPhotoOutlines = true;

  // Pan state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartCenterX = 0;
  private panStartCenterY = 0;

  // Picking mode
  private pickingMode = false;
  private onStarPicked: StarPickedCallback | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.view = { centerX: 0, centerY: 0, scale: 0, width: 0, height: 0 };
    this.setupEvents();
    this.resize();
  }

  setOnViewChange(cb: () => void) {
    this.onViewChange = cb;
  }

  setOnStarHover(cb: StarHoverCallback) {
    this.onStarHover = cb;
  }

  setOnDSOHover(cb: DSOHoverCallback) {
    this.onDSOHover = cb;
  }

  setShowDSOs(show: boolean) {
    this.showDSOs = show;
    this.render();
  }

  setShowStars(show: boolean) { this.showStars = show; this.render(); }
  setShowConstellationLines(show: boolean) { this.showConstellationLines = show; this.render(); }
  setShowConstellationNames(show: boolean) { this.showConstellationNames = show; this.render(); }
  setMaxMag(mag: number | null) { this.maxMagOverride = mag; this.render(); }
  setVisibleDSOTypes(types: Set<string>) { this.visibleDSOTypes = types; this.render(); }
  setShowGrid(show: boolean) { this.showGrid = show; this.render(); }
  setShowStarLabels(show: boolean) { this.showStarLabels = show; this.render(); }
  setSkyOpacity(v: number) { this.skyOpacity = v; this.render(); }
  setBackgroundOpacity(v: number) { this.backgroundOpacity = v; this.render(); }
  setPhotoOutlines(outlines: { name: string; corners: Point[] }[]) { this.photoOutlines = outlines; }
  setShowPhotoOutlines(show: boolean) { this.showPhotoOutlines = show; this.render(); }

  zoomBy(factor: number) {
    this.view.scale = Math.max(50, Math.min(100000, this.view.scale * factor));
    this.render();
    this.onViewChange?.();
  }

  panBy(dxPx: number, dyPx: number) {
    this.view.centerX += dxPx / this.view.scale;
    this.view.centerY -= dyPx / this.view.scale;
    this.render();
    this.onViewChange?.();
  }

  getShowGrid() { return this.showGrid; }

  navigateTo(ra: number, dec: number, targetScale = 600) {
    const p = project(ra, dec);
    this.view.centerX = p.x;
    this.view.centerY = p.y;
    this.view.scale = targetScale;
    this.render();
    this.onViewChange?.();
  }

  getView(): ViewState {
    return { ...this.view };
  }

  enterPickingMode(callback: StarPickedCallback) {
    this.pickingMode = true;
    this.onStarPicked = callback;
    this.canvas.style.cursor = 'crosshair';
  }

  exitPickingMode() {
    this.pickingMode = false;
    this.onStarPicked = null;
    this.canvas.style.cursor = 'default';
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view.width = rect.width;
    this.view.height = rect.height;

    // Default scale: fit equator circle in view
    if (this.view.scale === 0) {
      this.view.scale = Math.min(rect.width, rect.height) / 2.2;
    }

    this.render();
    this.onViewChange?.();
  }

  private findClosestStar(mx: number, my: number): Star | null {
    const projPt = fromCanvas(mx, my, this.view);
    const stars = getStars();
    const maxMag = this.maxMagOverride ?? computeMaxMag(this.view.scale);
    let closest: Star | null = null;
    let minDist = Infinity;
    const threshold = 8 / this.view.scale;

    for (const star of stars) {
      if (star.mag > maxMag) continue;
      const sp = project(star.ra, star.dec);
      const dx = sp.x - projPt.x;
      const dy = sp.y - projPt.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < threshold && dist < minDist) {
        minDist = dist;
        closest = star;
      }
    }

    return closest;
  }

  private setupEvents() {
    // Zoom with mouse wheel
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Get projection coords under mouse before zoom
      const before = fromCanvas(mx, my, this.view);

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.view.scale = Math.max(50, Math.min(100000, this.view.scale * factor));

      // Adjust center so point under mouse stays
      this.view.centerX = before.x - (mx - this.view.width / 2) / this.view.scale;
      this.view.centerY = before.y + (my - this.view.height / 2) / this.view.scale;

      this.render();
      this.onViewChange?.();
    }, { passive: false });

    // Pan with mouse drag
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.panStartCenterX = this.view.centerX;
        this.panStartCenterY = this.view.centerY;
        if (!this.pickingMode) {
          this.canvas.style.cursor = 'grabbing';
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        this.view.centerX = this.panStartCenterX - dx / this.view.scale;
        this.view.centerY = this.panStartCenterY + dy / this.view.scale;
        this.render();
        this.onViewChange?.();
      } else {
        // Hover detection
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (mx >= 0 && my >= 0 && mx <= this.view.width && my <= this.view.height) {
          this.handleHover(mx, my, e.clientX, e.clientY);
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        const moved = Math.abs(dx) + Math.abs(dy) > 3;

        this.isPanning = false;
        this.canvas.style.cursor = this.pickingMode ? 'crosshair' : 'default';

        // Picking mode: click (not drag) selects star
        if (this.pickingMode && !moved && this.onStarPicked) {
          const rect = this.canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const star = this.findClosestStar(mx, my);
          if (star) {
            this.onStarPicked(star);
          }
        }
      }
    });

    // Escape exits picking mode
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pickingMode) {
        this.exitPickingMode();
      }
    });
  }

  private findClosestDSO(mx: number, my: number): DSO | null {
    if (!this.showDSOs) return null;
    const projPt = fromCanvas(mx, my, this.view);
    const dsos = getDSOs();
    const maxMag = (this.maxMagOverride ?? computeMaxMag(this.view.scale)) + 4;
    let closest: DSO | null = null;
    let minDist = Infinity;
    const threshold = 20 / this.view.scale;

    for (const dso of dsos) {
      if (!this.visibleDSOTypes.has(dso.type)) continue;
      if (dso.mag !== null && dso.mag > maxMag) continue;
      if (dso.mag === null && this.maxMagOverride !== null) continue;
      const sp = project(dso.ra, dso.dec);
      const dx = sp.x - projPt.x;
      const dy = sp.y - projPt.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < threshold && dist < minDist) {
        minDist = dist;
        closest = dso;
      }
    }

    return closest;
  }

  private handleHover(mx: number, my: number, clientX: number, clientY: number) {
    const closestStar = this.findClosestStar(mx, my);

    if (this.onStarHover) {
      this.onStarHover(closestStar, clientX, clientY);
    }

    if (this.onDSOHover && !closestStar) {
      const closestDSO = this.findClosestDSO(mx, my);
      this.onDSOHover(closestDSO, clientX, clientY);
    } else if (this.onDSOHover && closestStar) {
      this.onDSOHover(null, clientX, clientY);
    }
  }

  render() {
    const { ctx, view } = this;
    const { width, height } = view;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    this.renderBackground();
    ctx.globalAlpha = this.skyOpacity;
    if (this.showGrid) {
      this.renderGrid();
    }
    if (this.showConstellationLines) {
      this.renderConstellationLines();
    }
    if (this.showDSOs) {
      this.renderDSOs();
    }
    if (this.showStars) {
      this.renderStars();
      if (this.showStarLabels) {
        this.renderStarLabels();
      }
    }
    if (this.showDSOs) {
      this.renderDSOLabels();
    }
    if (this.showConstellationNames) {
      this.renderConstellationNames();
    }

    ctx.restore();

    if (this.showPhotoOutlines && this.photoOutlines.length > 0) {
      this.renderPhotoOutlines();
    }
  }

  private renderPhotoOutlines() {
    const { ctx } = this;

    for (const outline of this.photoOutlines) {
      const { corners, name } = outline;
      if (corners.length < 4) continue;

      ctx.save();
      ctx.strokeStyle = 'rgba(100, 150, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x, corners[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      // Label above top-left corner
      ctx.setLineDash([]);
      ctx.font = '10px sans-serif';
      ctx.fillStyle = 'rgba(100, 150, 255, 0.7)';
      ctx.fillText(name, corners[0].x, corners[0].y - 4);

      ctx.restore();
    }
  }

  private renderBackground() {
    const { ctx, view } = this;
    const cx = view.width / 2;
    const cy = view.height / 2;
    const maxR = Math.sqrt(view.width * view.width + view.height * view.height);

    // Solid black base
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, view.width, view.height);

    // Gradient overlay with adjustable opacity
    ctx.save();
    ctx.globalAlpha = this.backgroundOpacity;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    gradient.addColorStop(0, '#0a0a2e');
    gradient.addColorStop(1, '#000008');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.restore();
  }

  private renderGrid() {
    const { ctx, view } = this;
    const origin = toCanvas(0, 0, view);

    // Declination circles every 10°
    ctx.lineWidth = 0.5;
    for (let dec = 80; dec >= -10; dec -= 10) {
      const r = Math.tan((90 - dec) / 2 * DEG2RAD) * view.scale;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = dec === 0
        ? 'rgba(80, 80, 140, 0.4)'
        : 'rgba(40, 40, 90, 0.2)';
      ctx.lineWidth = dec === 0 ? 1.5 : 0.5;
      ctx.stroke();

      // Dec label
      if (dec >= 0 && dec < 90) {
        const labelPt = toCanvas(0, Math.tan((90 - dec) / 2 * DEG2RAD), view);
        ctx.fillStyle = 'rgba(100, 100, 160, 0.5)';
        ctx.font = '10px sans-serif';
        ctx.fillText(`${dec}°`, labelPt.x + 4, labelPt.y - 2);
      }
    }

    // RA lines every 2h (30°)
    const maxR = Math.tan((90 - (-10)) / 2 * DEG2RAD) * view.scale;
    for (let raH = 0; raH < 24; raH += 2) {
      const raDeg = raH * 15;
      const raRad = raDeg * DEG2RAD;

      const dx = -Math.sin(raRad);
      const dy = Math.cos(raRad);

      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(
        origin.x + dx * maxR,
        origin.y - dy * maxR,
      );
      ctx.strokeStyle = 'rgba(40, 40, 90, 0.2)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // RA label near equator
      const labelR = Math.tan((90 - 5) / 2 * DEG2RAD) * view.scale;
      const lx = origin.x + dx * labelR;
      const ly = origin.y - dy * labelR;
      ctx.fillStyle = 'rgba(100, 100, 160, 0.5)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${raH}h`, lx, ly);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  private renderConstellationLines() {
    const { ctx, view } = this;
    const lines = getConstellationLines();

    ctx.strokeStyle = 'rgba(60, 80, 160, 0.3)';
    ctx.lineWidth = 1;

    for (const constellation of lines) {
      for (const segment of constellation.segments) {
        if (segment.length < 2) continue;

        ctx.beginPath();
        const first = project(segment[0][0], segment[0][1]);
        const firstC = toCanvas(first.x, first.y, view);
        ctx.moveTo(firstC.x, firstC.y);

        for (let i = 1; i < segment.length; i++) {
          const p = project(segment[i][0], segment[i][1]);
          const c = toCanvas(p.x, p.y, view);
          ctx.lineTo(c.x, c.y);
        }

        ctx.stroke();
      }
    }
  }

  private renderStars() {
    const { ctx, view } = this;
    const stars = getStars();
    const maxMag = this.maxMagOverride ?? computeMaxMag(view.scale);

    for (const star of stars) {
      if (star.mag > maxMag) continue;

      const p = project(star.ra, star.dec);
      const c = toCanvas(p.x, p.y, view);

      // Skip if off-screen (with margin)
      if (c.x < -20 || c.x > view.width + 20 || c.y < -20 || c.y > view.height + 20) {
        continue;
      }

      const radius = starRadius(star.mag);
      const [r, g, b] = bvToRgb(star.bv);

      // Glow for bright stars
      if (star.mag < 2) {
        const glowR = radius * 4;
        const gradient = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, glowR);
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.3)`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(c.x - glowR, c.y - glowR, glowR * 2, glowR * 2);
      }

      // Star dot
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fill();
    }
  }

  private renderStarLabels() {
    const { ctx, view } = this;
    const stars = getStars();

    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(200, 200, 255, 0.7)';
    ctx.textBaseline = 'middle';

    for (const star of stars) {
      if (star.mag > 3 || !star.name) continue;

      const p = project(star.ra, star.dec);
      const c = toCanvas(p.x, p.y, view);

      if (c.x < -50 || c.x > view.width + 50 || c.y < -50 || c.y > view.height + 50) {
        continue;
      }

      const r = starRadius(star.mag);
      ctx.fillText(star.name, c.x + r + 3, c.y);
    }

    ctx.textBaseline = 'alphabetic';
  }

  private renderDSOs() {
    const { ctx, view } = this;
    const dsos = getDSOs();
    // Magnitude cutoff: slightly more generous than stars
    const maxMag = this.maxMagOverride ?? (6 + Math.log2(view.scale / 200) * 1.5);

    for (const dso of dsos) {
      if (!this.visibleDSOTypes.has(dso.type)) continue;
      if (dso.mag !== null && dso.mag > maxMag) continue;
      if (dso.mag === null && this.maxMagOverride !== null) continue;

      const p = project(dso.ra, dso.dec);
      const c = toCanvas(p.x, p.y, view);

      const majorArcmin = dso.majAxis ?? 1;
      const minorArcmin = dso.minAxis ?? majorArcmin;
      const rx = Math.max(2, angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale));
      const ry = Math.max(2, angularSizeToCanvasPx(minorArcmin / 2, dso.dec, view.scale));
      const angle = dsoCanvasAngle(dso.pa, dso.ra);

      // Skip if completely off-screen
      const margin = rx + 20;
      if (c.x < -margin || c.x > view.width + margin || c.y < -margin || c.y > view.height + margin) {
        continue;
      }

      // Opacity based on magnitude
      const mag = dso.mag ?? 10;
      const opacity = Math.min(1, Math.max(0.3, 1 - (mag - 4) * 0.07));

      ctx.save();
      ctx.globalAlpha = opacity * this.skyOpacity;
      ctx.translate(c.x, c.y);
      ctx.rotate(angle);

      switch (dso.type) {
        case 'Gx': {
          // Galaxy: filled ellipse with golden gradient
          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
          grad.addColorStop(0, 'rgba(220, 180, 100, 0.8)');
          grad.addColorStop(0.5, 'rgba(180, 140, 70, 0.5)');
          grad.addColorStop(1, 'rgba(150, 100, 40, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(1, rx / ry);
          ctx.strokeStyle = 'rgba(220, 180, 100, 0.6)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'OC': {
          // Open cluster: dashed circle, light blue
          ctx.strokeStyle = 'rgba(140, 180, 255, 0.7)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case 'GC': {
          // Globular cluster: filled circle with gradient + cross
          const gcR = rx;
          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, gcR);
          grad.addColorStop(0, 'rgba(255, 220, 100, 0.7)');
          grad.addColorStop(0.6, 'rgba(220, 160, 60, 0.4)');
          grad.addColorStop(1, 'rgba(180, 120, 30, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, gcR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 200, 80, 0.6)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(0, 0, gcR, 0, Math.PI * 2);
          ctx.stroke();
          // Cross
          ctx.beginPath();
          ctx.moveTo(-gcR, 0); ctx.lineTo(gcR, 0);
          ctx.moveTo(0, -gcR); ctx.lineTo(0, gcR);
          ctx.stroke();
          break;
        }
        case 'EN': {
          // Emission nebula: reddish ellipse gradient
          const enGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
          enGrad.addColorStop(0, 'rgba(255, 80, 80, 0.4)');
          enGrad.addColorStop(0.5, 'rgba(200, 50, 80, 0.2)');
          enGrad.addColorStop(1, 'rgba(180, 30, 60, 0)');
          ctx.fillStyle = enGrad;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(1, rx / ry);
          ctx.strokeStyle = 'rgba(220, 80, 80, 0.4)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'RN': {
          // Reflection nebula: blue ellipse
          const rnGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
          rnGrad.addColorStop(0, 'rgba(80, 120, 255, 0.4)');
          rnGrad.addColorStop(0.5, 'rgba(60, 100, 200, 0.2)');
          rnGrad.addColorStop(1, 'rgba(40, 80, 180, 0)');
          ctx.fillStyle = rnGrad;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(1, rx / ry);
          ctx.strokeStyle = 'rgba(80, 140, 255, 0.4)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'PN': {
          // Planetary nebula: double circle, blue-cyan
          ctx.strokeStyle = 'rgba(80, 200, 220, 0.8)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(80, 200, 220, 0.5)';
          ctx.beginPath();
          ctx.arc(0, 0, rx * 0.4, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'SNR': {
          // Supernova remnant: green-teal ellipse
          const snrGrad = ctx.createRadialGradient(0, 0, rx * 0.6, 0, 0, rx);
          snrGrad.addColorStop(0, 'rgba(80, 200, 150, 0)');
          snrGrad.addColorStop(0.7, 'rgba(80, 200, 150, 0.2)');
          snrGrad.addColorStop(1, 'rgba(60, 180, 120, 0.5)');
          ctx.fillStyle = snrGrad;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(1, rx / ry);
          ctx.strokeStyle = 'rgba(80, 200, 150, 0.5)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'DN': {
          // Dark nebula: simple dark outline
          ctx.strokeStyle = 'rgba(120, 120, 140, 0.5)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        default: {
          // Unknown: simple circle
          ctx.strokeStyle = 'rgba(160, 160, 160, 0.4)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }

      ctx.restore();
    }
  }

  private renderDSOLabels() {
    const { ctx, view } = this;
    const dsos = getDSOs();
    const maxMag = this.maxMagOverride ?? (6 + Math.log2(view.scale / 200) * 1.5);

    const TYPE_COLORS: Record<string, string> = {
      'Gx':  'rgba(220, 180, 100, 0.8)',
      'OC':  'rgba(140, 180, 255, 0.8)',
      'GC':  'rgba(255, 200, 80, 0.8)',
      'EN':  'rgba(220, 100, 100, 0.8)',
      'RN':  'rgba(100, 150, 255, 0.8)',
      'PN':  'rgba(80, 200, 220, 0.9)',
      'SNR': 'rgba(80, 200, 150, 0.8)',
      'DN':  'rgba(120, 120, 140, 0.6)',
      '?':   'rgba(160, 160, 160, 0.6)',
    };

    ctx.textBaseline = 'middle';

    for (const dso of dsos) {
      if (!this.visibleDSOTypes.has(dso.type)) continue;
      if (dso.mag !== null && dso.mag > maxMag) continue;
      if (dso.mag === null && this.maxMagOverride !== null) continue;

      const isMess = dso.id.startsWith('M') && !dso.id.startsWith('M0');
      const majorArcmin = dso.majAxis ?? 1;
      const rx = angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale);

      // Label visibility rules
      if (isMess && view.scale <= 100) continue;
      if (!isMess && (view.scale <= 300 || rx <= 4)) continue;

      const p = project(dso.ra, dso.dec);
      const c = toCanvas(p.x, p.y, view);

      if (c.x < -80 || c.x > view.width + 80 || c.y < -20 || c.y > view.height + 20) {
        continue;
      }

      const label = isMess ? dso.id : dso.id.replace('NGC', 'NGC ').replace('IC', 'IC ');
      ctx.font = '9px sans-serif';
      ctx.fillStyle = TYPE_COLORS[dso.type] || 'rgba(160, 160, 160, 0.7)';
      ctx.fillText(label, c.x + Math.max(2, rx) + 2, c.y);
    }

    ctx.textBaseline = 'alphabetic';
  }

  private renderConstellationNames() {
    const { ctx, view } = this;
    const infos = getConstellationInfos();

    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(100, 120, 180, 0.4)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const info of infos) {
      if (info.dec < -20) continue;

      const p = project(info.ra, info.dec);
      const c = toCanvas(p.x, p.y, view);

      if (c.x < -100 || c.x > view.width + 100 || c.y < -100 || c.y > view.height + 100) {
        continue;
      }

      ctx.fillText(info.nameFr.toUpperCase(), c.x, c.y);
    }

    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}
