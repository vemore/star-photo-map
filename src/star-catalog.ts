import type { Star, ConstellationLine, ConstellationInfo } from './types';

let stars: Star[] = [];
let starsByHip = new Map<number, Star>();
let constellationLines: ConstellationLine[] = [];
let constellationInfos: ConstellationInfo[] = [];

function normalizeRA(ra: number): number {
  while (ra < 0) ra += 360;
  while (ra >= 360) ra -= 360;
  return ra;
}

export async function loadCatalog(): Promise<void> {
  const [starsData, linesData, namesData, constData] = await Promise.all([
    fetch('/data/stars.6.json').then(r => r.json()),
    fetch('/data/constellations.lines.json').then(r => r.json()),
    fetch('/data/starnames.json').then(r => r.json()),
    fetch('/data/constellations.json').then(r => r.json()),
  ]);

  // Parse stars
  for (const f of starsData.features) {
    const hip: number = f.id;
    const [ra, dec]: [number, number] = f.geometry.coordinates;
    const info = namesData[String(hip)];
    const star: Star = {
      hip,
      ra: normalizeRA(ra),
      dec,
      mag: f.properties.mag,
      bv: parseFloat(f.properties.bv) || 0,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      constellation: info?.c || undefined,
      desig: info?.desig || undefined,
    };
    stars.push(star);
    starsByHip.set(hip, star);
  }

  // Sort by magnitude (brightest first) for rendering priority
  stars.sort((a, b) => a.mag - b.mag);

  // Parse constellation lines
  for (const f of linesData.features) {
    constellationLines.push({
      id: f.id,
      segments: f.geometry.coordinates.map((seg: number[][]) =>
        seg.map(([ra, dec]: number[]) => [normalizeRA(ra), dec] as [number, number])
      ),
    });
  }

  // Parse constellation info
  for (const f of constData.features) {
    constellationInfos.push({
      id: f.id,
      name: f.properties.name,
      nameFr: f.properties.fr || f.properties.name,
      ra: normalizeRA(f.geometry.coordinates[0]),
      dec: f.geometry.coordinates[1],
    });
  }
}

export function getStars(): Star[] {
  return stars;
}

export function getStarByHip(hip: number): Star | undefined {
  return starsByHip.get(hip);
}

export function getConstellationLines(): ConstellationLine[] {
  return constellationLines;
}

export function getConstellationInfos(): ConstellationInfo[] {
  return constellationInfos;
}

export function getNamedStars(): Star[] {
  return stars.filter(s => s.name || s.bayer);
}
