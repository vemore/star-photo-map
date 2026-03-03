import type { Photo, PhotoCorrespondence, PlateSolveResult, AstrometrySolveStatus } from './types';
import { t } from './i18n';

export interface StarSearchResult {
  hip: number;
  ra: number;
  dec: number;
  mag: number;
  bv: number;
  name?: string;
  bayer?: string;
  flam?: string;
  constellation?: string;
  desig?: string;
  label: string;
  score: number;
}

export async function searchStarsAPI(query: string, limit = 10): Promise<StarSearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`/api/stars/search?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export function uploadPhoto(
  file: File,
  correspondences: PhotoCorrespondence[],
  onProgress?: (fraction: number) => void,
): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('correspondences', JSON.stringify(correspondences));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photos');

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error(t('errors.invalidResponse')));
        }
      } else {
        reject(new Error(t('errors.uploadFailed', { response: xhr.responseText })));
      }
    };

    xhr.onerror = () => reject(new Error(t('errors.networkError')));
    xhr.send(formData);
  });
}

export async function getPhotos(): Promise<Photo[]> {
  const res = await fetch('/api/photos');
  if (!res.ok) throw new Error(t('errors.loadPhotos'));
  return res.json();
}

export async function deletePhotoAPI(id: string): Promise<void> {
  const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(t('errors.deletePhoto'));
}

export async function solveWCS(file: File): Promise<PlateSolveResult> {
  const formData = new FormData();
  formData.append('photo', file);

  const res = await fetch('/api/solve-wcs', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(t('errors.wcsError', { text }));
  }

  return res.json();
}

export async function submitPlateSolve(file: File): Promise<{ jobId: string }> {
  const formData = new FormData();
  formData.append('photo', file);

  const res = await fetch('/api/solve-plate', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || t('errors.submitFailed'));
  }

  return res.json();
}

export async function pollPlateSolve(jobId: string): Promise<AstrometrySolveStatus> {
  const res = await fetch(`/api/solve-plate/${jobId}`);
  if (!res.ok) throw new Error(t('errors.pollFailed'));
  return res.json();
}

export async function solveWithASTAP(file: File): Promise<PlateSolveResult> {
  const fd = new FormData();
  fd.append('photo', file);
  const res = await fetch('/api/solve-astap', { method: 'POST', body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { success: false, error: data.error ?? t('errors.astapError') };
  }
  return res.json();
}
