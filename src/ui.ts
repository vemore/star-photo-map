import type { Star, DSO } from './types';
import { SkyMap } from './sky-map';
import { PhotoOverlay } from './photo-overlay';
import { searchDSOs, DSO_TYPE_NAMES } from './search';
import { getStars } from './star-catalog';

function angularDistance(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const toRad = Math.PI / 180;
  const d1 = dec1 * toRad;
  const d2 = dec2 * toRad;
  const dra = (ra2 - ra1) * toRad;
  const cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dra);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / toRad;
}

function formatSize(majAxis: number | null, minAxis: number | null): string {
  if (majAxis === null) return '—';
  const maj = majAxis >= 1 ? `${majAxis.toFixed(1)}'` : `${(majAxis * 60).toFixed(0)}"`;
  if (minAxis === null || Math.abs(majAxis - minAxis) < 0.1) return maj;
  const min = minAxis >= 1 ? `${minAxis.toFixed(1)}'` : `${(minAxis * 60).toFixed(0)}"`;
  return `${maj} × ${min}`;
}

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

  // ─── DSO section ────────────────────────────────────────────────────────────
  const dsoSection = document.createElement('div');
  dsoSection.className = 'dso-section';

  const dsoTitle = document.createElement('h2');
  dsoTitle.textContent = 'Objets du ciel profond';
  dsoSection.appendChild(dsoTitle);

  // Toggle checkbox
  const toggleRow = document.createElement('div');
  toggleRow.className = 'dso-toggle-row';
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'dso-toggle-label';
  const toggleCheck = document.createElement('input');
  toggleCheck.type = 'checkbox';
  toggleCheck.checked = true;
  toggleCheck.addEventListener('change', () => {
    skyMap.setShowDSOs(toggleCheck.checked);
  });
  toggleLabel.appendChild(toggleCheck);
  toggleLabel.append(' Afficher les DSO');
  toggleRow.appendChild(toggleLabel);
  dsoSection.appendChild(toggleRow);

  // ─── Display controls section ─────────────────────────────────────────────
  const displaySection = document.createElement('div');
  displaySection.className = 'display-controls-section';

  const displayTitle = document.createElement('div');
  displayTitle.className = 'display-controls-title';
  displayTitle.textContent = 'Affichage';
  displaySection.appendChild(displayTitle);

  function makeCheckRow(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'dso-toggle-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    row.appendChild(cb);
    row.append(` ${label}`);
    return row;
  }

  displaySection.appendChild(makeCheckRow('Afficher les étoiles', true, (v) => {
    skyMap.setShowStars(v);
    magRow.style.opacity = v ? '1' : '0.4';
    magSlider.disabled = !v;
  }));
  displaySection.appendChild(makeCheckRow('Traits des constellations', true, (v) => skyMap.setShowConstellationLines(v)));
  displaySection.appendChild(makeCheckRow('Noms des constellations', true, (v) => skyMap.setShowConstellationNames(v)));

  // Magnitude slider
  const magRow = document.createElement('div');
  magRow.className = 'display-controls-mag-row';

  const magLabelEl = document.createElement('label');
  magLabelEl.className = 'display-controls-mag-label';

  const magSlider = document.createElement('input');
  magSlider.type = 'range';
  magSlider.min = '6';
  magSlider.max = '11';
  magSlider.step = '0.5';
  magSlider.value = '8.5';
  magSlider.className = 'display-controls-mag-slider';

  const magValue = document.createElement('span');
  magValue.className = 'display-controls-mag-value';
  magValue.textContent = '8.5';

  magSlider.addEventListener('input', () => {
    const v = parseFloat(magSlider.value);
    magValue.textContent = v.toFixed(1);
    skyMap.setMaxMag(v);
  });

  magLabelEl.append('Magnitude max ');
  magRow.appendChild(magLabelEl);
  magRow.appendChild(magSlider);
  magRow.appendChild(magValue);
  displaySection.appendChild(magRow);

  panel.appendChild(displaySection);

  // Search input
  const dsoSearchWrapper = document.createElement('div');
  dsoSearchWrapper.className = 'dso-search-wrapper';

  const dsoInput = document.createElement('input');
  dsoInput.type = 'text';
  dsoInput.placeholder = 'Rechercher M31, NGC 7000…';
  dsoInput.className = 'star-search-input';

  const dsoDropdown = document.createElement('div');
  dsoDropdown.className = 'search-dropdown';

  dsoSearchWrapper.appendChild(dsoInput);
  dsoSearchWrapper.appendChild(dsoDropdown);
  dsoSection.appendChild(dsoSearchWrapper);

  // Info panel (shown after selecting a DSO)
  const dsoInfoPanel = document.createElement('div');
  dsoInfoPanel.className = 'dso-info-panel';
  dsoInfoPanel.style.display = 'none';
  dsoSection.appendChild(dsoInfoPanel);

  // Nearby stars panel
  const nearbyPanel = document.createElement('div');
  nearbyPanel.className = 'dso-nearby-panel';
  nearbyPanel.style.display = 'none';
  dsoSection.appendChild(nearbyPanel);

  panel.appendChild(dsoSection);

  function showDSOInfo(dso: DSO) {
    const typeName = DSO_TYPE_NAMES[dso.type] || 'Objet';
    const magStr = dso.mag !== null ? dso.mag.toFixed(1) : '—';
    const sizeStr = formatSize(dso.majAxis, dso.minAxis);
    const nameStr = dso.nameFr ? `<div class="dso-info-name">${dso.nameFr}</div>` : '';

    dsoInfoPanel.innerHTML = `
      ${nameStr}
      <table class="dso-info-table">
        <tr><td>Type</td><td>${typeName}</td></tr>
        <tr><td>Magnitude</td><td>${magStr}</td></tr>
        <tr><td>Taille</td><td>${sizeStr}</td></tr>
        <tr><td>RA / Déc</td><td>${dso.ra.toFixed(2)}° / ${dso.dec.toFixed(2)}°</td></tr>
      </table>
    `;
    dsoInfoPanel.style.display = 'block';

    // Nearby stars (brightest 5 within 5°)
    const allStars = getStars();
    const nearby = allStars
      .filter(s => s.mag <= 6 && angularDistance(dso.ra, dso.dec, s.ra, s.dec) <= 5)
      .sort((a, b) => a.mag - b.mag)
      .slice(0, 5);

    if (nearby.length > 0) {
      nearbyPanel.innerHTML = '<div class="dso-nearby-title">Étoiles proches (&lt; 5°)</div>';
      for (const star of nearby) {
        const starEl = document.createElement('div');
        starEl.className = 'dso-nearby-star';
        const name = star.name || star.desig
          ? (star.name || `${star.desig} ${star.constellation || ''}`)
          : `HIP ${star.hip}`;
        starEl.textContent = `${name} (mag ${star.mag.toFixed(1)})`;
        starEl.addEventListener('click', () => {
          skyMap.navigateTo(star.ra, star.dec, 600);
        });
        nearbyPanel.appendChild(starEl);
      }
      nearbyPanel.style.display = 'block';
    } else {
      nearbyPanel.style.display = 'none';
    }
  }

  dsoInput.addEventListener('input', () => {
    const results = searchDSOs(dsoInput.value);
    dsoDropdown.innerHTML = '';
    if (results.length === 0) {
      dsoDropdown.style.display = 'none';
      return;
    }
    dsoDropdown.style.display = 'block';
    for (const result of results) {
      const item = document.createElement('div');
      item.className = 'search-item';
      const magStr = result.dso.mag !== null ? `mag ${result.dso.mag.toFixed(1)}` : result.dso.type;
      item.innerHTML = `
        <span class="search-item-name">${result.label}</span>
        <span class="search-item-mag">${magStr}</span>
      `;
      item.addEventListener('click', () => {
        dsoInput.value = result.label;
        dsoDropdown.style.display = 'none';
        skyMap.navigateTo(result.dso.ra, result.dso.dec, 600);
        showDSOInfo(result.dso);
      });
      dsoDropdown.appendChild(item);
    }
  });

  dsoInput.addEventListener('blur', () => {
    setTimeout(() => { dsoDropdown.style.display = 'none'; }, 200);
  });

  dsoInput.addEventListener('focus', () => {
    if (dsoInput.value.length > 0) {
      dsoInput.dispatchEvent(new Event('input'));
    }
  });

  // ─── Star tooltip ────────────────────────────────────────────────────────────
  const tooltip = document.getElementById('tooltip')!;

  skyMap.setOnStarHover((star: Star | null, x: number, y: number) => {
    if (star) {
      const lines: string[] = [];
      if (star.name) lines.push(star.name);
      if (star.bayer && star.constellation) {
        lines.push(`${star.bayer} ${star.constellation}`);
      }
      lines.push(`HIP ${star.hip}`);
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

  // DSO tooltip
  skyMap.setOnDSOHover((dso: DSO | null, x: number, y: number) => {
    if (dso) {
      const typeName = DSO_TYPE_NAMES[dso.type] || 'Objet';
      const lines: string[] = [];
      lines.push(`<strong>${dso.id}</strong>`);
      if (dso.nameFr) lines.push(dso.nameFr);
      lines.push(typeName);
      if (dso.mag !== null) lines.push(`Magnitude : ${dso.mag.toFixed(1)}`);
      const sizeStr = formatSize(dso.majAxis, dso.minAxis);
      if (sizeStr !== '—') lines.push(`Taille : ${sizeStr}`);
      tooltip.innerHTML = lines.join('<br>');
      tooltip.style.left = `${x + 15}px`;
      tooltip.style.top = `${y + 15}px`;
      tooltip.style.display = 'block';
    } else {
      tooltip.style.display = 'none';
    }
  });

  // ─── Panel toggle ─────────────────────────────────────────────────────────
  const togglePanel = document.getElementById('toggle-panel')!;
  togglePanel.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    togglePanel.textContent = panel.classList.contains('collapsed') ? '◀' : '▶';
  });
}
