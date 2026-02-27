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

function makeSection(title: string, defaultOpen: boolean): { section: HTMLElement, content: HTMLElement } {
  const section = document.createElement('div');
  section.className = 'sidebar-section';
  if (!defaultOpen) section.classList.add('collapsed');

  const header = document.createElement('div');
  header.className = 'sidebar-section-header';

  const titleEl = document.createElement('span');
  titleEl.textContent = title;

  const chevron = document.createElement('span');
  chevron.className = 'sidebar-section-chevron';
  chevron.textContent = '▾';

  header.appendChild(titleEl);
  header.appendChild(chevron);
  section.appendChild(header);

  const content = document.createElement('div');
  content.className = 'sidebar-section-content';
  section.appendChild(content);

  header.addEventListener('click', () => {
    section.classList.toggle('collapsed');
  });

  return { section, content };
}

export function setupUI(skyMap: SkyMap, overlay: PhotoOverlay) {
  // Side panel
  const panel = document.getElementById('side-panel')!;
  const photoList = document.getElementById('photo-list')!;
  const addBtn = document.getElementById('add-photo-btn')!;

  // ─── Photos section (collapsible, open by default) ─────────────────────
  const { section: photoSection, content: photoContent } = makeSection('Photos', true);
  photoContent.appendChild(addBtn);
  photoContent.appendChild(photoList);
  panel.appendChild(photoSection);

  addBtn.addEventListener('click', () => {
    overlay.openRegistrationModal();
  });

  // Refresh photo list and outlines when photos change
  overlay.setOnPhotosChanged(() => {
    refreshPhotoList();
    skyMap.setPhotoOutlines(overlay.getPhotoCanvasOutlines(skyMap.getView()));
    skyMap.render();
  });

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
        const view = skyMap.getView();
        const fit = overlay.getPhotoCenterAndScale(placed.photo.id, view.width, view.height);
        if (fit) {
          skyMap.navigateTo(fit.ra, fit.dec, fit.scale);
        }
      });

      const controls = document.createElement('div');
      controls.className = 'photo-item-controls';

      const upBtn = document.createElement('button');
      upBtn.className = 'btn-icon btn-zorder';
      upBtn.title = 'Mettre devant';
      upBtn.textContent = '↑';
      upBtn.disabled = i >= photos.length - 1;
      upBtn.addEventListener('click', () => {
        overlay.movePhotoUp(placed.photo.id);
      });

      const downBtn = document.createElement('button');
      downBtn.className = 'btn-icon btn-zorder';
      downBtn.title = 'Mettre derrière';
      downBtn.textContent = '↓';
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

      const topRow = document.createElement('div');
      topRow.className = 'photo-item-top-row';
      topRow.appendChild(name);
      topRow.appendChild(controls);
      item.appendChild(topRow);

      // Per-photo opacity slider
      const opacitySlider = document.createElement('input');
      opacitySlider.type = 'range';
      opacitySlider.min = '0';
      opacitySlider.max = '1';
      opacitySlider.step = '0.05';
      opacitySlider.value = String(placed.opacity);
      opacitySlider.className = 'photo-opacity-slider';
      opacitySlider.addEventListener('input', () => {
        overlay.setPhotoOpacity(placed.photo.id, parseFloat(opacitySlider.value));
      });
      item.appendChild(opacitySlider);

      photoList.appendChild(item);
    }
  }

  refreshPhotoList();

  // ─── Star search section (collapsible, closed by default) ─────────────────
  const { section: starSection, content: starContent } = makeSection('Étoiles', false);

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
  starContent.appendChild(starSearchWrapper);

  const starInfoPanel = document.createElement('div');
  starInfoPanel.className = 'dso-info-panel';
  starInfoPanel.style.display = 'none';
  starContent.appendChild(starInfoPanel);

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
          skyMap.navigateTo(result.ra, result.dec, skyMap.getView().scale);
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

  // ─── DSO section (collapsible, closed by default) ──────────────────────────
  const { section: dsoSection, content: dsoContent } = makeSection('Objets du ciel profond', false);

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
  dsoContent.appendChild(toggleRow);

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

  dsoContent.appendChild(dsoTypeToggles);

  toggleCheck.addEventListener('change', () => {
    skyMap.setShowDSOs(toggleCheck.checked);
    for (const cb of dsoTypeChecks) {
      cb.disabled = !toggleCheck.checked;
    }
    dsoTypeToggles.style.opacity = toggleCheck.checked ? '1' : '0.4';
  });

  // ─── Display controls section (collapsible, open by default) ─────────────
  const { section: displaySection, content: displayContent } = makeSection('Affichage', true);

  function makeCheckRow(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement & { checkbox: HTMLInputElement } {
    const row = document.createElement('label');
    row.className = 'dso-toggle-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    row.appendChild(cb);
    row.append(` ${label}`);
    (row as any).checkbox = cb;
    return row as unknown as HTMLElement & { checkbox: HTMLInputElement };
  }

  displayContent.appendChild(makeCheckRow('Afficher les étoiles', true, (v) => {
    skyMap.setShowStars(v);
    magRow.style.opacity = v ? '1' : '0.4';
    magSlider.disabled = !v;
  }));
  displayContent.appendChild(makeCheckRow('Traits des constellations', true, (v) => skyMap.setShowConstellationLines(v)));
  displayContent.appendChild(makeCheckRow('Noms des constellations', true, (v) => skyMap.setShowConstellationNames(v)));
  displayContent.appendChild(makeCheckRow('Noms des étoiles', true, (v) => skyMap.setShowStarLabels(v)));
  const gridRow = makeCheckRow('Grille RA/Déc', true, (v) => skyMap.setShowGrid(v));
  displayContent.appendChild(gridRow);
  displayContent.appendChild(makeCheckRow('Cadres des photos', true, (v) => skyMap.setShowPhotoOutlines(v)));

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
  displayContent.appendChild(magRow);

  // Opacity sliders
  function makeSliderRow(label: string, min: number, max: number, step: number, defaultVal: number, onChange: (v: number) => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'display-controls-mag-row';
    const lbl = document.createElement('label');
    lbl.className = 'display-controls-mag-label';
    lbl.textContent = label + ' ';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(defaultVal);
    slider.className = 'display-controls-mag-slider';
    const val = document.createElement('span');
    val.className = 'display-controls-mag-value';
    val.textContent = defaultVal.toFixed(2);
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      val.textContent = v.toFixed(2);
      onChange(v);
    });
    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(val);
    return row;
  }

  displayContent.appendChild(makeSliderRow('Opacité ciel', 0, 1, 0.05, 0.8, (v) => skyMap.setSkyOpacity(v)));
  displayContent.appendChild(makeSliderRow('Gradient de fond', 0, 1, 0.05, 1, (v) => skyMap.setBackgroundOpacity(v)));

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
  dsoContent.appendChild(dsoSearchWrapper);

  // Info panel (shown after selecting a DSO)
  const dsoInfoPanel = document.createElement('div');
  dsoInfoPanel.className = 'dso-info-panel';
  dsoInfoPanel.style.display = 'none';
  dsoContent.appendChild(dsoInfoPanel);

  // Nearby stars panel
  const nearbyPanel = document.createElement('div');
  nearbyPanel.className = 'dso-nearby-panel';
  nearbyPanel.style.display = 'none';
  dsoContent.appendChild(nearbyPanel);

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
          skyMap.navigateTo(star.ra, star.dec, skyMap.getView().scale);
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
        skyMap.navigateTo(result.dso.ra, result.dso.dec, skyMap.getView().scale);
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

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    // Ignore when focused on an input/textarea
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    const view = skyMap.getView();

    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        skyMap.zoomBy(1.3);
        break;
      case '-':
        e.preventDefault();
        skyMap.zoomBy(1 / 1.3);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        skyMap.panBy(-view.width * 0.1, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        skyMap.panBy(view.width * 0.1, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        skyMap.panBy(0, -view.height * 0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        skyMap.panBy(0, view.height * 0.1);
        break;
      case 'h':
      case 'H':
        panel.classList.toggle('collapsed');
        togglePanel.textContent = panel.classList.contains('collapsed') ? '◀' : '▶';
        break;
      case 'g':
      case 'G': {
        const newVal = !skyMap.getShowGrid();
        skyMap.setShowGrid(newVal);
        gridRow.checkbox.checked = newVal;
        break;
      }
    }
  });
}
