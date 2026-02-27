import { wcsToCorrespondences, loadServerCatalog } from './wcs-reader.js';

interface AstrometryJob {
  localId: string;
  submissionId?: number;
  jobId?: number;
  status: 'pending' | 'solving' | 'solved' | 'failed' | 'timeout';
  correspondences?: Array<{
    pointIndex: number;
    photoX: number;
    photoY: number;
    starHip: number;
    starName: string;
  }>;
  error?: string;
  imageWidth: number;
  imageHeight: number;
}

const API_BASE = 'https://nova.astrometry.net/api';
const jobs = new Map<string, AstrometryJob>();
const jobCreatedAt = new Map<string, number>();
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
let sessionKey: string | null = null;

function evictStaleJobs() {
  const now = Date.now();
  for (const [id, createdAt] of jobCreatedAt) {
    if (now - createdAt > JOB_TTL_MS) {
      jobs.delete(id);
      jobCreatedAt.delete(id);
    }
  }
}

async function login(): Promise<string> {
  const apiKey = process.env.ASTROMETRY_API_KEY;
  if (!apiKey) throw new Error('ASTROMETRY_API_KEY non configurée');

  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `request-json=${encodeURIComponent(JSON.stringify({ apikey: apiKey }))}`,
  });

  const data = await res.json();
  if (data.status !== 'success') {
    throw new Error(`Échec de l'authentification astrometry.net: ${data.errormessage || 'unknown'}`);
  }

  sessionKey = data.session;
  return sessionKey!;
}

async function getSession(): Promise<string> {
  if (sessionKey) return sessionKey;
  return login();
}

export function isConfigured(): boolean {
  return !!process.env.ASTROMETRY_API_KEY;
}

export async function submitJob(
  imageBuffer: Buffer,
  filename: string,
  imageWidth: number,
  imageHeight: number,
): Promise<string> {
  const session = await getSession();
  const localId = crypto.randomUUID();

  evictStaleJobs();

  const job: AstrometryJob = {
    localId,
    status: 'pending',
    imageWidth,
    imageHeight,
  };
  jobs.set(localId, job);
  jobCreatedAt.set(localId, Date.now());

  // Upload via multipart form
  const boundary = '----AstrometryBoundary' + Date.now();
  const requestJson = JSON.stringify({
    session,
    publicly_visible: 'n',
    allow_modifications: 'n',
    allow_commercial_use: 'n',
  });

  const parts: Buffer[] = [];

  // request-json part
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="request-json"\r\n\r\n` +
    requestJson + `\r\n`
  ));

  // file part
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`
  ));
  parts.push(imageBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  try {
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    });

    const data = await res.json();
    if (data.status !== 'success') {
      job.status = 'failed';
      job.error = data.errormessage || 'Upload refusé';
      return localId;
    }

    job.submissionId = data.subid;
    job.status = 'solving';

    // Start polling in background
    pollJob(localId);
  } catch (err: any) {
    job.status = 'failed';
    job.error = err.message;
  }

  return localId;
}

async function pollJob(localId: string) {
  const job = jobs.get(localId);
  if (!job || !job.submissionId) return;

  const delays = [3000, 5000, 8000, 13000, 13000, 13000, 13000, 13000]; // ~80s total
  let attempt = 0;

  // First: poll submission to get job ID
  while (attempt < delays.length) {
    await sleep(delays[Math.min(attempt, delays.length - 1)]);
    attempt++;

    if (job.status !== 'solving') return;

    try {
      const subRes = await fetch(`${API_BASE}/submissions/${job.submissionId}`);
      const subData = await subRes.json();

      if (subData.jobs && subData.jobs.length > 0 && subData.jobs[0] !== null) {
        job.jobId = subData.jobs[0];
        break;
      }
    } catch {
      // Retry
    }
  }

  if (!job.jobId) {
    job.status = 'timeout';
    job.error = 'Timeout: pas de job créé';
    return;
  }

  // Poll job status
  while (attempt < delays.length + 8) {
    await sleep(delays[Math.min(attempt, delays.length - 1)]);
    attempt++;

    if (job.status !== 'solving') return;

    try {
      const jobRes = await fetch(`${API_BASE}/jobs/${job.jobId}`);
      const jobData = await jobRes.json();

      if (jobData.status === 'success') {
        // Get calibration
        const calRes = await fetch(`${API_BASE}/jobs/${job.jobId}/calibration/`);
        const cal = await calRes.json();

        // Convert calibration to WCS-like data and then to correspondences
        const correspondences = calibrationToCorrespondences(cal, job.imageWidth, job.imageHeight);
        if (correspondences.length >= 3) {
          job.status = 'solved';
          job.correspondences = correspondences;
        } else {
          job.status = 'failed';
          job.error = 'Calibration obtenue mais aucune étoile du catalogue trouvée dans le champ';
        }
        return;
      } else if (jobData.status === 'failure') {
        job.status = 'failed';
        job.error = 'Résolution échouée';
        return;
      }
      // else still solving, continue polling
    } catch {
      // Retry
    }
  }

  job.status = 'timeout';
  job.error = 'Timeout: résolution trop longue';
}

function calibrationToCorrespondences(
  cal: any,
  imageWidth: number,
  imageHeight: number,
) {
  // astrometry.net calibration gives: ra, dec, radius, pixscale, orientation, parity
  // We need to reconstruct a CD matrix from pixscale and orientation
  const pixscale = cal.pixscale / 3600; // arcsec/pixel → degrees/pixel
  const orientation = cal.orientation * (Math.PI / 180); // degrees → radians
  const parity = cal.parity || 1; // 1 or -1

  // CD matrix from pixscale + orientation + parity
  const cd11 = -pixscale * Math.cos(orientation) * parity;
  const cd12 = pixscale * Math.sin(orientation);
  const cd21 = -pixscale * Math.sin(orientation) * parity;
  const cd22 = -pixscale * Math.cos(orientation);

  const wcs = {
    CRPIX1: imageWidth / 2,
    CRPIX2: imageHeight / 2,
    CRVAL1: cal.ra,
    CRVAL2: cal.dec,
    CD1_1: cd11,
    CD1_2: cd12,
    CD2_1: cd21,
    CD2_2: cd22,
    NAXIS1: imageWidth,
    NAXIS2: imageHeight,
  };

  // Make sure server catalog is loaded
  loadServerCatalog();

  return wcsToCorrespondences(wcs, imageWidth, imageHeight);
}

export function getJobStatus(localId: string): AstrometryJob | undefined {
  return jobs.get(localId);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
