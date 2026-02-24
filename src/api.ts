import type { Photo, PhotoCorrespondence } from './types';

export async function uploadPhoto(
  file: File,
  correspondences: PhotoCorrespondence[],
): Promise<Photo> {
  const formData = new FormData();
  formData.append('photo', file);
  formData.append('correspondences', JSON.stringify(correspondences));

  const res = await fetch('/api/photos', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Échec de l'upload : ${text}`);
  }

  return res.json();
}

export async function getPhotos(): Promise<Photo[]> {
  const res = await fetch('/api/photos');
  if (!res.ok) throw new Error('Impossible de charger les photos');
  return res.json();
}

export async function deletePhotoAPI(id: string): Promise<void> {
  const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Impossible de supprimer la photo');
}
