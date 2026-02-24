import type { Star, ViewState, Point } from './types';
import { project, toCanvas, fromCanvas, unproject } from './projection';
import { getStars, getConstellationLines, getConstellationInfos } from './star-catalog';

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

export type StarHoverCallback = (star: Star | null, x: number, y: number) => void;

export class SkyMap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private view: ViewState;
  private onViewChange: (() => void) | null = null;
  private onStarHover: StarHoverCallback | null = null;

  // Pan state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartCenterX = 0;
  private panStartCenterY = 0;

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

  getView(): ViewState {
    return { ...this.view };
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
      this.view.scale = Math.max(50, Math.min(10000, this.view.scale * factor));

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
        this.canvas.style.cursor = 'grabbing';
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

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = 'default';
      }
    });
  }

  private handleHover(mx: number, my: number, clientX: number, clientY: number) {
    if (!this.onStarHover) return;

    const projPt = fromCanvas(mx, my, this.view);
    const stars = getStars();
    let closest: Star | null = null;
    let minDist = Infinity;
    const threshold = 8 / this.view.scale; // 8px in projection coords

    for (const star of stars) {
      if (star.mag > 5) continue;
      const sp = project(star.ra, star.dec);
      const dx = sp.x - projPt.x;
      const dy = sp.y - projPt.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < threshold && dist < minDist) {
        minDist = dist;
        closest = star;
      }
    }

    this.onStarHover(closest, clientX, clientY);
  }

  render() {
    const { ctx, view } = this;
    const { width, height } = view;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    this.renderBackground();
    this.renderGrid();
    this.renderConstellationLines();
    this.renderStars();
    this.renderStarLabels();
    this.renderConstellationNames();

    ctx.restore();
  }

  private renderBackground() {
    const { ctx, view } = this;
    const cx = view.width / 2;
    const cy = view.height / 2;
    const maxR = Math.sqrt(view.width * view.width + view.height * view.height);

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    gradient.addColorStop(0, '#0a0a2e');
    gradient.addColorStop(1, '#000008');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, view.width, view.height);
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

    for (const star of stars) {
      // Skip very faint stars or those far from visible area
      if (star.dec < -30) continue;

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
      if (star.dec < -30) continue;

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
