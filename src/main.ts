import { loadCatalog } from './star-catalog';
import { loadDSOCatalog } from './dso-catalog';
import { SkyMap } from './sky-map';
import { PhotoOverlay } from './photo-overlay';
import { getPhotos } from './api';
import { setupUI } from './ui';
import { showToast } from './toast';
import './style.css';

async function init() {
  const loadingOverlay = document.getElementById('loading-overlay');

  // Load star and DSO catalogs in parallel
  try {
    await Promise.all([loadCatalog(), loadDSOCatalog()]);
  } catch (err: any) {
    // Show error in loading overlay instead of spinner
    if (loadingOverlay) {
      loadingOverlay.innerHTML = `<div class="loading-error">${err.message || 'Erreur de chargement des catalogues'}</div>`;
    }
    return;
  }

  // Remove loading overlay
  if (loadingOverlay) {
    loadingOverlay.classList.add('fade-out');
    loadingOverlay.addEventListener('transitionend', () => loadingOverlay.remove());
  }

  // Init sky map
  const canvas = document.getElementById('sky-canvas') as HTMLCanvasElement;
  const skyMap = new SkyMap(canvas);

  // Init photo overlay
  const overlayDiv = document.getElementById('photo-layer') as HTMLDivElement;
  const overlay = new PhotoOverlay(overlayDiv, () => skyMap.getView(), skyMap);

  // Update photo transforms and outlines when map view changes
  skyMap.setOnViewChange(() => {
    overlay.updateTransforms();
    skyMap.setPhotoOutlines(overlay.getPhotoCanvasOutlines(skyMap.getView()));
  });

  // Resize handler
  window.addEventListener('resize', () => skyMap.resize());

  // Setup UI (panel, buttons, tooltips)
  setupUI(skyMap, overlay);

  // Load existing photos from backend
  try {
    const photos = await getPhotos();
    overlay.loadPhotos(photos);
  } catch {
    showToast({ message: 'Impossible de charger les photos depuis le serveur', type: 'error' });
  }
}

init();
