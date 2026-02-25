#!/usr/bin/env node
/**
 * test-plate-solver.mjs
 * Tests the local plate solver pipeline on a real astrophoto.
 * Usage: node scripts/test-plate-solver.mjs [path/to/image.jpg]
 *
 * Reproduces exactly what the browser does:
 *   1. Load image → downscale to 1000px wide → extract grayscale pixels
 *   2. Background subtraction + threshold → connected components → spots
 *   3. Build triangle hash index from star catalog (mag < 5.5)
 *   4. Match detected triangles to catalog → affine transform → verify
 */

import sharp from '../node_modules/sharp/lib/index.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const imagePath = process.argv[2]
  ?? join(ROOT, 'test-photos/M42+M43-Large.jpg');

// ─── Config ─────────────────────────────────────────────────────────────────
const TARGET_WIDTH = 1000;
const MAG_LIMIT_INDEX = 5.5;   // stars used to build the triangle index
const MAG_LIMIT_VERIFY = 8.0;  // stars used during verification
const BIN_SIZE = 0.002;
const MAX_ANG_DIST_DEG = 15;
const TOLERANCE_DEG = 0.5;
const DEG2RAD = Math.PI / 180;

// ─── 1. Star catalog ─────────────────────────────────────────────────────────
function loadCatalog() {
  const starsData = JSON.parse(readFileSync(join(ROOT, 'public/data/stars.8.json'), 'utf8'));
  const namesData = JSON.parse(readFileSync(join(ROOT, 'public/data/starnames.json'), 'utf8'));

  const stars = [];
  for (const f of starsData.features) {
    const hip = f.id;
    let [ra, dec] = f.geometry.coordinates;
    while (ra < 0) ra += 360;
    while (ra >= 360) ra -= 360;
    const info = namesData[String(hip)];
    stars.push({
      hip,
      ra,
      dec,
      mag: f.properties.mag,
      name: info?.name,
      bayer: info?.bayer,
      constellation: info?.c,
      desig: info?.desig,
    });
  }
  stars.sort((a, b) => a.mag - b.mag);
  console.log(`Catalog: ${stars.length} stars loaded`);
  return stars;
}

function starLabel(s) {
  if (s.name) return s.name;
  if (s.desig && s.constellation) return `${s.desig} ${s.constellation}`;
  return `HIP ${s.hip}`;
}

// ─── 2. Image → grayscale pixels ─────────────────────────────────────────────
async function loadImage(path) {
  const meta = await sharp(path).metadata();
  const origW = meta.width;
  const origH = meta.height;

  const scale = Math.min(1, TARGET_WIDTH / origW);
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);

  console.log(`Image: ${origW}×${origH} → downscaled to ${w}×${h} (scale=${scale.toFixed(3)})`);

  const { data } = await sharp(path)
    .resize(w, h, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = data.length / (w * h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (channels >= 3) {
      gray[i] = 0.299 * data[i * channels] + 0.587 * data[i * channels + 1] + 0.114 * data[i * channels + 2];
    } else {
      gray[i] = data[i * channels];
    }
  }

  return { gray, w, h, origW, origH, scaleFromOriginal: origW / w };
}

// ─── 3. Star detection ───────────────────────────────────────────────────────
function boxBlur(input, w, h, radius) {
  const temp = new Float32Array(w * h);
  const output = new Float32Array(w * h);
  const size = radius * 2 + 1;

  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += input[y * w + Math.max(0, Math.min(x, w - 1))];
    for (let x = 0; x < w; x++) {
      temp[y * w + x] = sum / size;
      sum += input[y * w + Math.min(x + radius + 1, w - 1)] - input[y * w + Math.max(x - radius, 0)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += temp[Math.max(0, Math.min(y, h - 1)) * w + x];
    for (let y = 0; y < h; y++) {
      output[y * w + x] = sum / size;
      sum += temp[Math.min(y + radius + 1, h - 1) * w + x] - temp[Math.max(y - radius, 0) * w + x];
    }
  }
  return output;
}

function detectStars(gray, w, h) {
  const radius = Math.max(25, Math.min(100, Math.round(Math.min(w, h) * 0.07)));
  console.log(`  blur radius: ${radius}px`);
  const background = boxBlur(gray, w, h, radius);
  const sub = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) sub[i] = Math.max(0, gray[i] - background[i]);

  let sum = 0, sumSq = 0;
  for (let i = 0; i < w * h; i++) { sum += sub[i]; sumSq += sub[i] ** 2; }
  const mean = sum / (w * h);
  const sigma = Math.sqrt(Math.max(0, sumSq / (w * h) - mean ** 2));
  const threshold = mean + 3 * sigma;

  console.log(`Detection: mean=${mean.toFixed(1)}, sigma=${sigma.toFixed(1)}, threshold=${threshold.toFixed(1)}`);

  // Connected components
  const labels = new Int32Array(w * h).fill(-1);
  const parent = [];

  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

  let nextLabel = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (sub[idx] < threshold) continue;
      const above = y > 0 ? labels[(y-1)*w+x] : -1;
      const left  = x > 0 ? labels[y*w+x-1]   : -1;
      if (above === -1 && left === -1) { labels[idx] = nextLabel; parent.push(nextLabel++); }
      else if (above !== -1 && left === -1) { labels[idx] = find(above); }
      else if (above === -1 && left !== -1) { labels[idx] = find(left); }
      else { const ra = find(above), rl = find(left); labels[idx] = ra; if (ra !== rl) union(ra, rl); }
    }
  }

  const comps = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (labels[idx] === -1) continue;
      const root = find(labels[idx]);
      const val = sub[idx];
      let c = comps.get(root);
      if (!c) { c = { sx: 0, sy: 0, sb: 0, count: 0 }; comps.set(root, c); }
      c.sx += x * val; c.sy += y * val; c.sb += val; c.count++;
    }
  }

  const maxSpotSize = Math.min(160, Math.max(80, Math.round(w * h * 0.0004)));
  console.log(`  max spot size: ${maxSpotSize}px`);
  const spots = [];
  for (const c of comps.values()) {
    if (c.count < 2) continue;
    if (c.count > maxSpotSize) continue; // skip nebulae / extended objects
    spots.push({ x: c.sx / c.sb, y: c.sy / c.sb, brightness: c.sb, size: c.count });
  }
  spots.sort((a, b) => b.brightness - a.brightness);
  return spots.slice(0, 40);
}

// ─── 4. Triangle index ───────────────────────────────────────────────────────
function buildIndex(stars) {
  const indexStars = stars.filter(s => s.mag < MAG_LIMIT_INDEX);
  console.log(`Triangle index: using ${indexStars.length} stars (mag < ${MAG_LIMIT_INDEX})`);

  const vecs = indexStars.map(s => {
    const ra = s.ra * DEG2RAD, dec = s.dec * DEG2RAD;
    return { star: s, x: Math.cos(dec)*Math.cos(ra), y: Math.cos(dec)*Math.sin(ra), z: Math.sin(dec) };
  });

  const index = new Map();
  const maxDot = Math.cos(MAX_ANG_DIST_DEG * DEG2RAD);
  let triCount = 0;

  for (let i = 0; i < vecs.length; i++) {
    for (let j = i+1; j < vecs.length; j++) {
      const dotIJ = vecs[i].x*vecs[j].x + vecs[i].y*vecs[j].y + vecs[i].z*vecs[j].z;
      if (dotIJ < maxDot) continue;
      const dIJ = Math.acos(Math.min(1, Math.max(-1, dotIJ)));

      for (let k = j+1; k < vecs.length; k++) {
        const dotIK = vecs[i].x*vecs[k].x + vecs[i].y*vecs[k].y + vecs[i].z*vecs[k].z;
        if (dotIK < maxDot) continue;
        const dotJK = vecs[j].x*vecs[k].x + vecs[j].y*vecs[k].y + vecs[j].z*vecs[k].z;
        if (dotJK < maxDot) continue;

        const dIK = Math.acos(Math.min(1, Math.max(-1, dotIK)));
        const dJK = Math.acos(Math.min(1, Math.max(-1, dotJK)));
        const dists = [dIJ, dIK, dJK].sort((a,b)=>a-b);
        const dMax = dists[2];
        if (dMax < 0.5 * DEG2RAD) continue;

        const r1 = dists[0] / dMax, r2 = dists[1] / dMax;
        const key = Math.round(r1/BIN_SIZE)*10000 + Math.round(r2/BIN_SIZE);
        let bucket = index.get(key);
        if (!bucket) { bucket = []; index.set(key, bucket); }
        bucket.push({ stars: [vecs[i].star, vecs[j].star, vecs[k].star], dists });
        triCount++;
      }
    }
  }

  console.log(`Triangle index: ${triCount} triangles in ${index.size} buckets`);
  return { index, indexStars };
}

// ─── 5. Projection ───────────────────────────────────────────────────────────
function project(ra, dec) {
  const raRad = ra * DEG2RAD;
  const r = Math.tan((90 - dec) / 2 * DEG2RAD);
  return { x: -r * Math.sin(raRad), y: r * Math.cos(raRad) };
}

// ─── 6. Plate solving ────────────────────────────────────────────────────────
function pixDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function generatePerms([a, b, c]) {
  return [[a,b,c],[a,c,b],[b,a,c],[b,c,a],[c,a,b],[c,b,a]];
}

function verifyMatch(spotIndices, catStars, topSpots, allSpots, allCatProjected) {
  const photoPoints = spotIndices.map(si => topSpots[si]);
  const projPoints  = catStars.map(s => project(s.ra, s.dec));
  const [p0,p1,p2] = photoPoints;
  const [c0,c1,c2] = projPoints;

  const det = p0.x*(p1.y-p2.y) - p0.y*(p1.x-p2.x) + (p1.x*p2.y - p2.x*p1.y);
  if (Math.abs(det) < 1e-10) return null;
  const iD = 1/det;
  const inv = [
    [(p1.y-p2.y)*iD, (p2.y-p0.y)*iD, (p0.y-p1.y)*iD],
    [(p2.x-p1.x)*iD, (p0.x-p2.x)*iD, (p1.x-p0.x)*iD],
    [(p1.x*p2.y-p2.x*p1.y)*iD, (p2.x*p0.y-p0.x*p2.y)*iD, (p0.x*p1.y-p1.x*p0.y)*iD],
  ];
  const a = inv[0][0]*c0.x + inv[0][1]*c1.x + inv[0][2]*c2.x;
  const cc= inv[1][0]*c0.x + inv[1][1]*c1.x + inv[1][2]*c2.x;
  const e = inv[2][0]*c0.x + inv[2][1]*c1.x + inv[2][2]*c2.x;
  const b = inv[0][0]*c0.y + inv[0][1]*c1.y + inv[0][2]*c2.y;
  const d = inv[1][0]*c0.y + inv[1][1]*c1.y + inv[1][2]*c2.y;
  const f = inv[2][0]*c0.y + inv[2][1]*c1.y + inv[2][2]*c2.y;

  // Sanity check: plate scale 5 arcmin–35° FOV at ~1000px
  const plateScale = Math.sqrt(a*a + b*b);
  if (plateScale < 1e-6 || plateScale > 8e-4) return null;

  const tol = TOLERANCE_DEG * DEG2RAD;
  const correspondences = [];
  const usedStars = new Set();

  for (let m = 0; m < 3; m++) {
    correspondences.push({ photoX: topSpots[spotIndices[m]].x, photoY: topSpots[spotIndices[m]].y,
      starHip: catStars[m].hip, starName: starLabel(catStars[m]), pointIndex: m });
    usedStars.add(catStars[m].hip);
  }

  const spotsToCheck = allSpots.slice(0, 30);
  for (const spot of spotsToCheck) {
    if (spotIndices.some(si => topSpots[si] === spot)) continue;
    const projX = a*spot.x + cc*spot.y + e;
    const projY = b*spot.x +  d*spot.y + f;
    let bestDist = tol, bestStar = null;
    for (const { star, proj } of allCatProjected) {
      if (usedStars.has(star.hip)) continue;
      const dist = Math.hypot(proj.x - projX, proj.y - projY);
      if (dist < bestDist) { bestDist = dist; bestStar = star; }
    }
    if (bestStar) {
      usedStars.add(bestStar.hip);
      correspondences.push({ photoX: spot.x, photoY: spot.y,
        starHip: bestStar.hip, starName: starLabel(bestStar), pointIndex: correspondences.length });
    }
  }

  return correspondences.length >= 5 ? { correspondences, verified: correspondences.length } : null;
}

function solvePlate(spots, allStars, triIndex) {
  const topSpots = spots.slice(0, 10);
  const n = topSpots.length;
  const allCatProjected = allStars.filter(s => s.mag < MAG_LIMIT_VERIFY).map(s => ({ star: s, proj: project(s.ra, s.dec) }));

  let bestMatch = null;
  let triTested = 0;

  console.log(`\nSolving with ${n} anchor spots, testing triangles...`);

  for (let i = 0; i < n-2 && (!bestMatch || bestMatch.verified < 8); i++) {
    for (let j = i+1; j < n-1 && (!bestMatch || bestMatch.verified < 8); j++) {
      for (let k = j+1; k < n && (!bestMatch || bestMatch.verified < 8); k++) {
        const dIJ = pixDist(topSpots[i], topSpots[j]);
        const dIK = pixDist(topSpots[i], topSpots[k]);
        const dJK = pixDist(topSpots[j], topSpots[k]);
        const pd = [{d:dIJ,s:[i,j]},{d:dIK,s:[i,k]},{d:dJK,s:[j,k]}].sort((a,b)=>a.d-b.d);
        const dMax = pd[2].d;
        if (dMax < 10) continue;

        const r1 = pd[0].d/dMax, r2 = pd[1].d/dMax;
        const candidates = [];
        for (let dr1=-1; dr1<=1; dr1++) for (let dr2=-1; dr2<=1; dr2++) {
          const key = (Math.round(r1/BIN_SIZE)+dr1)*10000 + (Math.round(r2/BIN_SIZE)+dr2);
          const b = triIndex.get(key);
          if (b) candidates.push(...b);
        }
        if (candidates.length === 0) continue;

        for (const catTri of candidates) {
          for (const perm of generatePerms([i,j,k])) {
            triTested++;
            const match = verifyMatch(perm, catTri.stars, topSpots, spots, allCatProjected);
            if (match && (!bestMatch || match.verified > bestMatch.verified)) {
              bestMatch = match;
              if (match.verified >= 8) break;
            }
          }
          if (bestMatch?.verified >= 5) break;
        }
      }
    }

    if (bestMatch?.verified >= 5) break;
  }

  return { bestMatch, triTested };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Plate Solver Test ===`);
  console.log(`Image: ${imagePath}\n`);

  const t0 = Date.now();

  // Load catalog
  const allStars = loadCatalog();

  // Load image
  const { gray, w, h, origW, origH, scaleFromOriginal } = await loadImage(imagePath);

  // Detect stars
  console.log('\n--- Star Detection ---');
  const t1 = Date.now();
  const spots = detectStars(gray, w, h);
  console.log(`Detected ${spots.length} spots in ${Date.now()-t1}ms`);
  console.log('Top 15 spots (pixel coords, brightness):');
  spots.slice(0, 15).forEach((s, i) => {
    const ox = (s.x * scaleFromOriginal).toFixed(0);
    const oy = (s.y * scaleFromOriginal).toFixed(0);
    console.log(`  #${i+1}: px=(${s.x.toFixed(1)}, ${s.y.toFixed(1)}) orig=(${ox},${oy}) bright=${s.brightness.toFixed(0)} size=${s.size}`);
  });

  if (spots.length < 3) {
    console.error('\nFAIL: not enough spots detected');
    process.exit(1);
  }

  // Build triangle index
  console.log('\n--- Triangle Index ---');
  const t2 = Date.now();
  const { index: triIndex } = buildIndex(allStars);
  console.log(`Index built in ${Date.now()-t2}ms`);

  // Solve
  console.log('\n--- Plate Solving ---');
  const t3 = Date.now();
  const { bestMatch, triTested } = solvePlate(spots, allStars, triIndex);
  const solveTime = Date.now() - t3;
  console.log(`Tested ${triTested} triangle permutations in ${solveTime}ms`);

  if (!bestMatch || bestMatch.verified < 5) {
    console.log(`\nFAIL: no solution found (best verified: ${bestMatch?.verified ?? 0})`);

    // Diagnostic: show which bright catalog stars would be in the FOV
    // (We don't know FOV yet, but we can check what the annotated image tells us)
    console.log('\n--- Diagnostic: Orion-area bright stars in catalog ---');
    const orionStars = allStars.filter(s => {
      const ra = s.ra;
      const dec = s.dec;
      // Orion region: RA 70-100°, Dec -20 to +20°
      return ra > 70 && ra < 100 && dec > -20 && dec < 20 && s.mag < 7;
    });
    orionStars.slice(0, 20).forEach(s => {
      console.log(`  ${starLabel(s).padEnd(20)} HIP ${s.hip} mag=${s.mag.toFixed(2)} RA=${s.ra.toFixed(2)}° Dec=${s.dec.toFixed(2)}°`);
    });
    process.exit(1);
  }

  // SUCCESS
  console.log(`\nSUCCESS: ${bestMatch.verified} correspondences found`);
  console.log('\nMatched stars:');
  bestMatch.correspondences.forEach((c, i) => {
    const ox = (c.photoX * scaleFromOriginal).toFixed(0);
    const oy = (c.photoY * scaleFromOriginal).toFixed(0);
    console.log(`  [${i}] ${c.starName.padEnd(25)} HIP ${c.starHip} → photo (${ox}, ${oy})`);
  });

  // Verify field center
  const c0 = bestMatch.correspondences[0];
  const c1 = bestMatch.correspondences[1];
  const star0 = allStars.find(s => s.hip === c0.starHip);
  const star1 = allStars.find(s => s.hip === c1.starHip);
  if (star0 && star1) {
    const centerRA  = (star0.ra  + star1.ra)  / 2;
    const centerDec = (star0.dec + star1.dec) / 2;
    console.log(`\nApprox field center: RA=${centerRA.toFixed(2)}°, Dec=${centerDec.toFixed(2)}°`);
  }

  console.log(`\nTotal time: ${Date.now()-t0}ms`);
}

main().catch(err => { console.error(err); process.exit(1); });
