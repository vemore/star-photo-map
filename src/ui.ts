import type { Star, DSO } from './types';
import { SkyMap } from './sky-map';
import { PhotoOverlay } from './photo-overlay';
import { searchDSOs, DSO_TYPE_NAMES } from './search';
import { searchStarsAPI } from './api';
import type { StarSearchResult } from './api';
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

    for (let i = 0; i < photos.length; i++) {
      const placed = photos[i];
      const item = document.createElement('div');
      item.className = 'photo-list-item';

      const name = document.createElement('span');
      name.className = 'photo-item-name';
      name.textContent = placed.photo.originalName;
      name.title = placed.photo.originalName;
      name.style.cursor = 'pointer';
      name.addEventListener('click', () => {
        const center = overlay.getPhotoCenter(placed.photo.id);
        if (center) {
          skyMap.navigateTo(center.ra, center.dec, 600);
        }
      });

      const controls = document.createElement('div');
      controls.className = 'photo-item-controls';

      const upBtn = document.createElement('button');
      upBtn.className = 'btn-icon';
      upBtn.title = 'Mettre devant';
      upBtn.textContent = '▲';
      upBtn.disabled = i >= photos.length - 1;
      upBtn.addEventListener('click', () => {
        overlay.movePhotoUp(placed.photo.id);
      });

      const downBtn = document.createElement('button');
      downBtn.className = 'btn-icon';
      downBtn.title = 'Mettre derrière';
      downBtn.textContent = '▼';
      downBtn.disabled = i <= 0;
      downBtn.addEventListener('click', () => {
        overlay.movePhotoDown(placed.photo.id);
      });

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

      controls.appendChild(upBtn);
      controls.appendChild(downBtn);
      controls.appendChild(toggleBtn);
      controls.appendChild(deleteBtn);
      item.appendChild(name);
      item.appendChild(controls);
      photoList.appendChild(item);
    }
  }

  refreshPhotoList();

  // ─── Star search section ──────────────────────────────────────────────────
  const starSection = document.createElement('div');
  starSection.className = 'star-search-section';

  const starTitle = document.createElement('h2');
  starTitle.textContent = 'Étoiles';
  starSection.appendChild(starTitle);

  const starSearchWrapper = document.createElement('div');
  starSearchWrapper.className = 'dso-search-wrapper';

  const starInput = document.createElement('input');
  starInput.type = 'text';
  starInput.placeholder = 'Rechercher Vega, \u03B1 Lyr, HIP 91262\u2026';
  starInput.className = 'star-search-input';

  const starDropdown = document.createElement('div');
  starDropdown.className = 'search-dropdown';

  starSearchWrapper.appendChild(starInput);
  starSearchWrapper.appendChild(starDropdown);
  starSection.appendChild(starSearchWrapper);

  const starInfoPanel = document.createElement('div');
  starInfoPanel.className = 'dso-info-panel';
  starInfoPanel.style.display = 'none';
  starSection.appendChild(starInfoPanel);

  panel.appendChild(starSection);

  function showStarInfo(star: StarSearchResult) {
    const nameStr = star.name ? `<div class="dso-info-name">${star.name}</div>` : '';
    const desigStr = star.desig && star.constellation
      ? `${star.desig} ${star.constellation}`
      : star.bayer && star.constellation
        ? `${star.bayer} ${star.constellation}`
        : '';
    const flamStr = star.flam && star.constellation ? `${star.flam} ${star.constellation}` : '';
    const raH = (star.ra / 15);
    const raHH = Math.floor(raH);
    const raMM = Math.floor((raH - raHH) * 60);
    const raSS = ((raH - raHH) * 60 - raMM) * 60;
    const raStr = `${raHH}h ${raMM}m ${raSS.toFixed(1)}s`;
    const decSign = star.dec >= 0 ? '+' : '';
    const decAbs = Math.abs(star.dec);
    const decDD = Math.floor(decAbs);
    const decMM = Math.floor((decAbs - decDD) * 60);
    const decSS = ((decAbs - decDD) * 60 - decMM) * 60;
    const decStr = `${decSign}${decDD}\u00B0 ${decMM}' ${decSS.toFixed(0)}"`;

    starInfoPanel.innerHTML = `
      ${nameStr}
      <table class="dso-info-table">
        ${desigStr ? `<tr><td>Désignation</td><td>${desigStr}</td></tr>` : ''}
        ${flamStr ? `<tr><td>Flamsteed</td><td>${flamStr}</td></tr>` : ''}
        <tr><td>HIP</td><td>${star.hip}</td></tr>
        <tr><td>Magnitude</td><td>${star.mag.toFixed(2)}</td></tr>
        ${star.constellation ? `<tr><td>Constellation</td><td>${star.constellation}</td></tr>` : ''}
        <tr><td>RA</td><td>${raStr}</td></tr>
        <tr><td>Déc</td><td>${decStr}</td></tr>
      </table>
    `;
    starInfoPanel.style.display = 'block';
  }

  let starDebounce: ReturnType<typeof setTimeout> | null = null;
  starInput.addEventListener('input', () => {
    if (starDebounce) clearTimeout(starDebounce);
    starDebounce = setTimeout(async () => {
      const query = starInput.value;
      if (!query || query.length < 1) {
        starDropdown.innerHTML = '';
        starDropdown.style.display = 'none';
        return;
      }
      const results = await searchStarsAPI(query);
      if (starInput.value !== query) return;
      starDropdown.innerHTML = '';
      if (results.length === 0) {
        starDropdown.style.display = 'none';
        return;
      }
      starDropdown.style.display = 'block';
      for (const result of results) {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.innerHTML = `
          <span class="search-item-name">${result.label}</span>
          <span class="search-item-mag">mag ${result.mag.toFixed(1)}</span>
        `;
        item.addEventListener('click', () => {
          starInput.value = result.label;
          starDropdown.style.display = 'none';
          skyMap.navigateTo(result.ra, result.dec, 600);
          showStarInfo(result);
        });
        starDropdown.appendChild(item);
      }
    }, 250);
  });

  starInput.addEventListener('blur', () => {
    setTimeout(() => { starDropdown.style.display = 'none'; }, 200);
  });

  starInput.addEventListener('focus', () => {
    if (starInput.value.length > 0) {
      starInput.dispatchEvent(new Event('input'));
    }
  });

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
  toggleLabel.appendChild(toggleCheck);
  toggleLabel.append(' Afficher les DSO');
  toggleRow.appendChild(toggleLabel);
  dsoSection.appendChild(toggleRow);

  // DSO type sub-toggles
  const dsoTypeToggles = document.createElement('div');
  dsoTypeToggles.className = 'dso-type-toggles';
  const dsoTypeChecks: HTMLInputElement[] = [];

  const DSO_TYPE_LABELS: Record<string, string> = {
    'Gx': 'Galaxies',
    'OC': 'Amas ouverts',
    'GC': 'Amas globulaires',
    'EN': 'Nébuleuses en émission',
    'RN': 'Nébuleuses par réflexion',
    'PN': 'Nébuleuses planétaires',
    'SNR': 'Rémanents de supernova',
    'DN': 'Nébuleuses sombres',
  };

  for (const [type, label] of Object.entries(DSO_TYPE_LABELS)) {
    const typeRow = document.createElement('label');
    typeRow.className = 'dso-toggle-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.dsoType = type;
    cb.addEventListener('change', () => {
      const types = new Set<string>();
      for (const c of dsoTypeChecks) {
        if (c.checked) types.add(c.dataset.dsoType!);
      }
      skyMap.setVisibleDSOTypes(types);
    });
    dsoTypeChecks.push(cb);
    typeRow.appendChild(cb);
    typeRow.append(` ${label}`);
    dsoTypeToggles.appendChild(typeRow);
  }

  dsoSection.appendChild(dsoTypeToggles);

  toggleCheck.addEventListener('change', () => {
    skyMap.setShowDSOs(toggleCheck.checked);
    for (const cb of dsoTypeChecks) {
      cb.disabled = !toggleCheck.checked;
    }
    dsoTypeToggles.style.opacity = toggleCheck.checked ? '1' : '0.4';
  });

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
  displaySection.appendChild(makeCheckRow('Noms des étoiles', true, (v) => skyMap.setShowStarLabels(v)));
  displaySection.appendChild(makeCheckRow('Grille RA/Déc', true, (v) => skyMap.setShowGrid(v)));

  // Magnitude slider
  const magRow = document.createElement('div');
  magRow.className = 'display-controls-mag-row';

  const magLabelEl = document.createElement('label');
  magLabelEl.className = 'display-controls-mag-label';

  const magSlider = document.createElement('input');
  magSlider.type = 'range';
  magSlider.min = '1';
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
