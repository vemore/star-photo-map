import type { DetectedSpot, StarDetectionResult } from './types';

const TARGET_WIDTH = 1000;

/**
 * Detect bright spots (stars) in an image.
 * Works on grayscale data extracted from a canvas.
 */
export function detectStars(
  imageData: ImageData,
  origWidth: number,
  origHeight: number,
): StarDetectionResult {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;
  const scaleFromOriginal = origWidth / w;

  // 1. Convert to grayscale Float32Array
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 2. Box blur (separable, radius 25) for background estimation
  const radius = 25;
  const background = boxBlur(gray, w, h, radius);

  // 3. Subtract background
  const subtracted = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    subtracted[i] = Math.max(0, gray[i] - background[i]);
  }

  // 4. Adaptive threshold: mean + 3*sigma of subtracted
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < w * h; i++) {
    sum += subtracted[i];
    sumSq += subtracted[i] * subtracted[i];
  }
  const mean = sum / (w * h);
  const variance = sumSq / (w * h) - mean * mean;
  const sigma = Math.sqrt(Math.max(0, variance));
  const threshold = mean + 3 * sigma;

  // 5. Connected component labeling (union-find)
  const labels = new Int32Array(w * h);
  labels.fill(-1);
  const parent: number[] = [];

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path compression
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  let nextLabel = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (subtracted[idx] < threshold) continue;

      const above = y > 0 ? labels[(y - 1) * w + x] : -1;
      const left = x > 0 ? labels[y * w + x - 1] : -1;

      if (above === -1 && left === -1) {
        labels[idx] = nextLabel;
        parent.push(nextLabel);
        nextLabel++;
      } else if (above !== -1 && left === -1) {
        labels[idx] = find(above);
      } else if (above === -1 && left !== -1) {
        labels[idx] = find(left);
      } else {
        const ra = find(above);
        const rl = find(left);
        labels[idx] = ra;
        if (ra !== rl) union(ra, rl);
      }
    }
  }

  // 6. Compute centroid (brightness-weighted) for each component
  const components = new Map<number, { sx: number; sy: number; sb: number; count: number }>();

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (labels[idx] === -1) continue;

      const root = find(labels[idx]);
      const val = subtracted[idx];

      let comp = components.get(root);
      if (!comp) {
        comp = { sx: 0, sy: 0, sb: 0, count: 0 };
        components.set(root, comp);
      }
      comp.sx += x * val;
      comp.sy += y * val;
      comp.sb += val;
      comp.count++;
    }
  }

  // 7. Build spots array, sort by brightness
  const spots: DetectedSpot[] = [];
  for (const comp of components.values()) {
    if (comp.count < 2) continue; // skip single-pixel noise
    spots.push({
      x: comp.sx / comp.sb,
      y: comp.sy / comp.sb,
      brightness: comp.sb,
      size: comp.count,
    });
  }

  spots.sort((a, b) => b.brightness - a.brightness);

  // Return top 40 spots
  return {
    spots: spots.slice(0, 40),
    imageWidth: w,
    imageHeight: h,
    scaleFromOriginal,
  };
}

/**
 * Detect stars from a File object (creates a temporary canvas).
 */
export function detectStarsFromFile(file: File): Promise<StarDetectionResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const origWidth = img.naturalWidth;
      const origHeight = img.naturalHeight;

      // Downscale to ~1000px wide
      const scale = Math.min(1, TARGET_WIDTH / origWidth);
      const w = Math.round(origWidth * scale);
      const h = Math.round(origHeight * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);

      const imageData = ctx.getImageData(0, 0, w, h);
      resolve(detectStars(imageData, origWidth, origHeight));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Impossible de charger l\'image'));
    };

    img.src = url;
  });
}

/**
 * Separable box blur.
 */
function boxBlur(input: Float32Array, w: number, h: number, radius: number): Float32Array {
  const temp = new Float32Array(w * h);
  const output = new Float32Array(w * h);
  const size = radius * 2 + 1;

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    let sum = 0;
    // Initialize window
    for (let x = -radius; x <= radius; x++) {
      sum += input[y * w + Math.max(0, Math.min(x, w - 1))];
    }
    for (let x = 0; x < w; x++) {
      temp[y * w + x] = sum / size;
      // Slide window
      const addX = Math.min(x + radius + 1, w - 1);
      const remX = Math.max(x - radius, 0);
      sum += input[y * w + addX] - input[y * w + remX];
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += temp[Math.max(0, Math.min(y, h - 1)) * w + x];
    }
    for (let y = 0; y < h; y++) {
      output[y * w + x] = sum / size;
      const addY = Math.min(y + radius + 1, h - 1);
      const remY = Math.max(y - radius, 0);
      sum += temp[addY * w + x] - temp[remY * w + x];
    }
  }

  return output;
}
