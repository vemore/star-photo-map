import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fsp, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { parseFITSHeader, wcsToCorrespondences } from './wcs-reader.js';
import type { WCSData } from './wcs-reader.js';

const execFileAsync = promisify(execFile);

interface SolveResult {
  success: boolean;
  correspondences?: Array<{
    pointIndex: number;
    photoX: number;
    photoY: number;
    starHip: number;
    starName: string;
  }>;
  error?: string;
}

function getASTAPBin(): string {
  return process.env.ASTAP_PATH || '/opt/astap/astap_cli';
}

export function isASTAPInstalled(): boolean {
  return existsSync(getASTAPBin());
}

export async function solveWithASTAP(
  buffer: Buffer,
  ext: string,
  width: number,
  height: number,
): Promise<SolveResult> {
  const bin = getASTAPBin();
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'astap-'));
  const imgName = `input${ext}`;
  const imgPath = path.join(tmpDir, imgName);
  const wcsPath = path.join(tmpDir, 'input.wcs');

  try {
    await fsp.writeFile(imgPath, buffer);

    try {
      await execFileAsync(bin, ['-f', imgPath, '-wcs', '-r', '180', '-z', '0'], {
        timeout: 60_000,
      });
    } catch (err: any) {
      if (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
        return { success: false, error: 'Timeout ASTAP (60 s)' };
      }
      // ASTAP may return non-zero even on success; check if .wcs was produced
      if (!existsSync(wcsPath)) {
        const detail = err.stderr || err.message || 'erreur inconnue';
        return { success: false, error: `ASTAP échoué : ${detail}` };
      }
    }

    if (!existsSync(wcsPath)) {
      return { success: false, error: "ASTAP n'a pas produit de fichier WCS" };
    }

    const wcsText = await fsp.readFile(wcsPath, 'utf-8');
    const parsed = parseFITSHeader(wcsText);

    const required = ['CRPIX1', 'CRPIX2', 'CRVAL1', 'CRVAL2', 'CD1_1', 'CD1_2', 'CD2_1', 'CD2_2'];
    for (const key of required) {
      if (typeof parsed[key] !== 'number') {
        return { success: false, error: `Clé WCS manquante : ${key}` };
      }
    }

    const wcs: WCSData = {
      CRPIX1: parsed.CRPIX1 as number,
      CRPIX2: parsed.CRPIX2 as number,
      CRVAL1: parsed.CRVAL1 as number,
      CRVAL2: parsed.CRVAL2 as number,
      CD1_1: parsed.CD1_1 as number,
      CD1_2: parsed.CD1_2 as number,
      CD2_1: parsed.CD2_1 as number,
      CD2_2: parsed.CD2_2 as number,
      NAXIS1: width,
      NAXIS2: height,
    };

    const correspondences = wcsToCorrespondences(wcs, width, height);
    if (correspondences.length < 3) {
      return { success: false, error: "Pas assez d'étoiles du catalogue dans le champ résolu" };
    }

    return { success: true, correspondences };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}
