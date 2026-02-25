import { loadCatalog } from './star-catalog';
import { loadDSOCatalog } from './dso-catalog';
import { SkyMap } from './sky-map';
import { PhotoOverlay } from './photo-overlay';
import { getPhotos } from './api';
import { setupUI } from './ui';
import './style.css';

async function init() {
  // Load star and DSO catalogs in parallel
  await Promise.all([loadCatalog(), loadDSOCatalog()]);

  // Init sky map
  const canvas = document.getElementById('sky-canvas') as HTMLCanvasElement;
  const skyMap = new SkyMap(canvas);

  // Init photo overlay
  const overlayDiv = document.getElementById('photo-layer') as HTMLDivElement;
  const overlay = new PhotoOverlay(overlayDiv, () => skyMap.getView(), skyMap);

  // Update photo transforms when map view changes
  skyMap.setOnViewChange(() => overlay.updateTransforms());

  // Resize handler
  window.addEventListener('resize', () => skyMap.resize());

  // Setup UI (panel, buttons, tooltips)
  setupUI(skyMap, overlay);

  // Load existing photos from backend
  try {
    const photos = await getPhotos();
    overlay.loadPhotos(photos);
  } catch {
    console.warn('Impossible de charger les photos depuis le serveur');
  }
}

init();
