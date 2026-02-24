import type { Star } from './types';
import { SkyMap } from './sky-map';
import { PhotoOverlay } from './photo-overlay';

export function setupUI(skyMap: SkyMap, overlay: PhotoOverlay) {
  // Side panel
  const panel = document.getElementById('side-panel')!;
  const photoList = document.getElementById('photo-list')!;
  const addBtn = document.getElementById('add-photo-btn')!;

  addBtn.addEventListener('click', () => {
    overlay.openRegistrationModal();
  });

  // Refresh photo list when photos change
  overlay.setOnPhotosChanged(() => refreshPhotoList());

  function refreshPhotoList() {
    photoList.innerHTML = '';
    const photos = overlay.getPlacedPhotos();

    if (photos.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-list';
      empty.textContent = 'Aucune photo ajoutée';
      photoList.appendChild(empty);
      return;
    }

    for (const placed of photos) {
      const item = document.createElement('div');
      item.className = 'photo-list-item';

      const name = document.createElement('span');
      name.className = 'photo-item-name';
      name.textContent = placed.photo.originalName;
      name.title = placed.photo.originalName;

      const controls = document.createElement('div');
      controls.className = 'photo-item-controls';

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn-icon';
      toggleBtn.title = placed.visible ? 'Masquer' : 'Afficher';
      toggleBtn.textContent = placed.visible ? '👁' : '👁‍🗨';
      toggleBtn.addEventListener('click', () => {
        overlay.toggleVisibility(placed.photo.id);
        refreshPhotoList();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-icon btn-danger';
      deleteBtn.title = 'Supprimer';
      deleteBtn.textContent = '✕';
      deleteBtn.addEventListener('click', async () => {
        if (confirm(`Supprimer « ${placed.photo.originalName} » ?`)) {
          await overlay.removePhoto(placed.photo.id);
        }
      });

      controls.appendChild(toggleBtn);
      controls.appendChild(deleteBtn);
      item.appendChild(name);
      item.appendChild(controls);
      photoList.appendChild(item);
    }
  }

  refreshPhotoList();

  // Tooltip for star hover
  const tooltip = document.getElementById('tooltip')!;

  skyMap.setOnStarHover((star: Star | null, x: number, y: number) => {
    if (star) {
      const lines: string[] = [];
      if (star.name) lines.push(star.name);
      if (star.bayer && star.constellation) {
        lines.push(`${star.bayer} ${star.constellation}`);
      }
      lines.push(`Magnitude : ${star.mag.toFixed(2)}`);
      if (star.constellation) {
        lines.push(`Constellation : ${star.constellation}`);
      }
      tooltip.innerHTML = lines.join('<br>');
      tooltip.style.left = `${x + 15}px`;
      tooltip.style.top = `${y + 15}px`;
      tooltip.style.display = 'block';
    } else {
      tooltip.style.display = 'none';
    }
  });

  // Panel toggle
  const togglePanel = document.getElementById('toggle-panel')!;
  togglePanel.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    togglePanel.textContent = panel.classList.contains('collapsed') ? '◀' : '▶';
  });
}
