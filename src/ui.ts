import type { Star, DSO, PhotoSection } from './types';
import { SkyMap } from './sky-map';
import { PhotoOverlay } from './photo-overlay';
import { getDSOTypeName, searchUnified } from './search';
import type { StarSearchResult } from './api';
import { getStars } from './star-catalog';
import { showToast } from './toast';
import { t, getLang, setLang } from './i18n';

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

// ─── Display settings persistence ────────────────────────────────────────────

const SETTINGS_KEY = 'display-settings';

const DSO_TYPES_ALL = ['Gx', 'OC', 'GC', 'EN', 'RN', 'PN', 'SNR', 'DN'];
const DSO_CATALOGS_ALL = ['M', 'NGC', 'IC', 'SH2'];

interface DisplaySettings {
  showStars: boolean;
  showConstellationLines: boolean;
  showConstellationNames: boolean;
  showStarLabels: boolean;
  showGrid: boolean;
  showPhotoOutlines: boolean;
  maxMagnitude: number;
  autoMagnitude: boolean;
  skyOpacity: number;
  backgroundOpacity: number;
  defaultPhotoOpacity: number;
  showDSOs: boolean;
  dsoTypes: string[];
  dsoCatalogs: string[];
}

const DEFAULT_SETTINGS: DisplaySettings = {
  showStars: true,
  showConstellationLines: true,
  showConstellationNames: true,
  showStarLabels: true,
  showGrid: true,
  showPhotoOutlines: true,
  maxMagnitude: 8.5,
  autoMagnitude: false,
  skyOpacity: 0.8,
  backgroundOpacity: 1.0,
  defaultPhotoOpacity: 1.0,
  showDSOs: true,
  dsoTypes: [...DSO_TYPES_ALL],
  dsoCatalogs: [...DSO_CATALOGS_ALL],
};

function loadSettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: DisplaySettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ─── Photo sections persistence ─────────────────────────────────────────────

const SECTIONS_KEY = 'photo-sections';

function loadSections(): PhotoSection[] {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [{
    id: 'default',
    name: t('photos.sections.defaultName'),
    photoIds: [],
    collapsed: false,
    visible: true,
  }];
}

function saveSections(sections: PhotoSection[]) {
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
}

function syncSectionsWithPhotos(sections: PhotoSection[], photoIds: string[]): PhotoSection[] {
  const allSectionedIds = new Set(sections.flatMap(s => s.photoIds));
  const existingIds = new Set(photoIds);

  // Add new photos to the first section
  for (const id of photoIds) {
    if (!allSectionedIds.has(id)) {
      sections[0].photoIds.push(id);
    }
  }

  // Remove deleted photos from all sections
  for (const section of sections) {
    section.photoIds = section.photoIds.filter(id => existingIds.has(id));
  }

  return sections;
}

export function setupUI(skyMap: SkyMap, overlay: PhotoOverlay) {
  const panel = document.getElementById('side-panel')!;
  const photoList = document.getElementById('photo-list')!;
  const addBtn = document.getElementById('add-photo-btn')!;

  const settings = loadSettings();
  let sections = loadSections();

  // Currently open gear popup state
  let currentGearPopupEl: HTMLElement | null = null;
  let currentGearPhotoId: string | null = null;
  let currentGearPopupRefresh: (() => void) | null = null;

  function closeGearPopup() {
    if (currentGearPopupEl) {
      currentGearPopupEl.remove();
      currentGearPopupEl = null;
      currentGearPhotoId = null;
      currentGearPopupRefresh = null;
    }
  }

  // Close gear popup on outside click
  document.addEventListener('click', (e) => {
    if (currentGearPopupEl && !currentGearPopupEl.contains(e.target as Node)) {
      // Check if the click was on a gear button (to allow toggle)
      const target = e.target as HTMLElement;
      if (!target.closest('.btn-gear')) {
        closeGearPopup();
      }
    }
  });

  // ─── Language selector ──────────────────────────────────────────────────────
  const langSelector = document.createElement('div');
  langSelector.className = 'lang-selector';
  const currentLang = getLang();

  for (const lang of ['FR', 'EN'] as const) {
    const btn = document.createElement('button');
    btn.className = 'lang-btn';
    btn.textContent = lang;
    if (lang.toLowerCase() === currentLang) {
      btn.classList.add('active');
    }
    btn.addEventListener('click', () => {
      setLang(lang.toLowerCase() as 'fr' | 'en');
    });
    langSelector.appendChild(btn);
  }
  panel.appendChild(langSelector);

  // ─── Photos section (collapsible, open by default) ─────────────────────
  const { section: photoSection, content: photoContent } = makeSection(t('photos.section'), true);
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
    const photoIds = photos.map(p => p.photo.id);

    // Sync sections with current photos
    sections = syncSectionsWithPhotos(sections, photoIds);
    saveSections(sections);

    if (photos.length === 0 && sections.length <= 1) {
      const empty = document.createElement('p');
      empty.className = 'empty-list';
      empty.textContent = t('photos.empty');
      photoList.appendChild(empty);
      renderNewSectionRow();
      return;
    }

    // Render each section
    for (const section of sections) {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'photo-section';
      if (section.collapsed) sectionEl.classList.add('collapsed');

      // Section header
      const header = document.createElement('div');
      header.className = 'photo-section-header';

      const chevron = document.createElement('span');
      chevron.className = 'photo-section-chevron';
      chevron.textContent = '▾';

      const nameEl = document.createElement('span');
      nameEl.className = 'photo-section-name';
      nameEl.textContent = section.name;

      const eyeBtn = document.createElement('button');
      eyeBtn.className = 'photo-section-eye' + (section.visible ? '' : ' hidden');
      eyeBtn.textContent = section.visible ? '👁' : '👁‍🗨';
      eyeBtn.title = section.visible ? t('photos.hide') : t('photos.show');
      eyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        section.visible = !section.visible;
        overlay.setMultiplePhotosVisible(section.photoIds, section.visible);
        saveSections(sections);
        refreshPhotoList();
      });

      header.appendChild(chevron);
      header.appendChild(nameEl);
      header.appendChild(eyeBtn);
      header.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.photo-section-eye')) return;
        section.collapsed = !section.collapsed;
        saveSections(sections);
        refreshPhotoList();
      });
      sectionEl.appendChild(header);

      // Section items
      const itemsEl = document.createElement('div');
      itemsEl.className = 'photo-section-items';

      for (const photoId of section.photoIds) {
        const placed = photos.find(p => p.photo.id === photoId);
        if (!placed) continue;

        const item = document.createElement('div');
        item.className = 'photo-list-item';

        const topRow = document.createElement('div');
        topRow.className = 'photo-item-top-row';

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

        // Eye button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn-icon';
        toggleBtn.title = placed.visible ? t('photos.hide') : t('photos.show');
        toggleBtn.textContent = placed.visible ? '👁' : '👁‍🗨';
        toggleBtn.addEventListener('click', () => {
          overlay.toggleVisibility(placed.photo.id);
          refreshPhotoList();
        });

        // Gear button
        const gearBtn = document.createElement('button');
        gearBtn.className = 'btn-icon btn-gear';
        gearBtn.title = t('photos.settings');
        gearBtn.textContent = '⚙';
        gearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentGearPhotoId === placed.photo.id) {
            closeGearPopup();
            return;
          }
          closeGearPopup();
          openGearPopup(placed.photo.id, item);
        });

        controls.appendChild(toggleBtn);
        controls.appendChild(gearBtn);

        topRow.appendChild(name);
        topRow.appendChild(controls);
        item.appendChild(topRow);
        itemsEl.appendChild(item);
      }

      sectionEl.appendChild(itemsEl);
      photoList.appendChild(sectionEl);
    }

    renderNewSectionRow();

    // Re-render gear popup if still open
    if (currentGearPhotoId && currentGearPopupRefresh) {
      currentGearPopupRefresh();
    }
  }

  function renderNewSectionRow() {
    const newRow = document.createElement('div');
    newRow.className = 'new-section-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'new-section-input';
    input.placeholder = t('photos.sections.newSection');

    const createBtn = document.createElement('button');
    createBtn.className = 'new-section-btn';
    createBtn.textContent = '+';
    createBtn.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) return;
      sections.push({
        id: `section-${Date.now()}`,
        name,
        photoIds: [],
        collapsed: false,
        visible: true,
      });
      saveSections(sections);
      refreshPhotoList();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createBtn.click();
    });

    newRow.appendChild(input);
    newRow.appendChild(createBtn);
    photoList.appendChild(newRow);
  }

  function openGearPopup(photoId: string, anchorItem: HTMLElement) {
    const placedPhoto = overlay.getPlacedPhotos().find(p => p.photo.id === photoId);
    if (!placedPhoto) return;
    const photoName = placedPhoto.photo.originalName;

    currentGearPhotoId = photoId;

    const popup = document.createElement('div');
    popup.className = 'photo-gear-popup';
    currentGearPopupEl = popup;

    function renderPopupContent() {
      popup.innerHTML = '';

      // 1. Opacity slider
      const opacitySection = document.createElement('div');
      opacitySection.className = 'gear-popup-section';
      const opacityLabel = document.createElement('div');
      opacityLabel.className = 'gear-popup-label';
      opacityLabel.textContent = t('photos.opacity');
      const opacitySlider = document.createElement('input');
      opacitySlider.type = 'range';
      opacitySlider.min = '0';
      opacitySlider.max = '1';
      opacitySlider.step = '0.05';
      const currentPlaced = overlay.getPlacedPhotos().find(p => p.photo.id === photoId);
      opacitySlider.value = String(currentPlaced?.opacity ?? 1);
      opacitySlider.className = 'gear-popup-slider';
      opacitySlider.addEventListener('input', () => {
        overlay.setPhotoOpacity(photoId, parseFloat(opacitySlider.value));
      });
      opacitySection.appendChild(opacityLabel);
      opacitySection.appendChild(opacitySlider);
      popup.appendChild(opacitySection);

      // 2. Z-order list
      const zSection = document.createElement('div');
      zSection.className = 'gear-popup-section';
      const zLabel = document.createElement('div');
      zLabel.className = 'gear-popup-label';
      zLabel.textContent = t('photos.zOrder');
      zSection.appendChild(zLabel);

      const allPhotos = overlay.getPlacedPhotos();
      const zList = document.createElement('div');
      zList.className = 'zorder-list';

      // Reversed: top of stack (last in array) shown first
      const reversed = [...allPhotos].reverse();
      for (let i = 0; i < reversed.length; i++) {
        const p = reversed[i];
        const zItem = document.createElement('div');
        zItem.className = 'zorder-item' + (p.photo.id === photoId ? ' current' : '');
        zItem.dataset.photoId = p.photo.id;

        const grip = document.createElement('span');
        grip.className = 'zorder-grip';
        grip.textContent = '⠿';

        const zName = document.createElement('span');
        zName.className = 'zorder-item-name';
        zName.textContent = p.photo.originalName;

        zItem.appendChild(grip);
        zItem.appendChild(zName);
        zList.appendChild(zItem);
      }

      // Drag & drop reordering
      let dragItem: HTMLElement | null = null;
      let dragPlaceholder: HTMLElement | null = null;
      let dragStartY = 0;
      let dragOffsetY = 0;

      zList.addEventListener('mousedown', (e) => {
        const grip = (e.target as HTMLElement).closest('.zorder-grip');
        if (!grip) return;
        e.preventDefault();
        dragItem = grip.parentElement as HTMLElement;
        const rect = dragItem.getBoundingClientRect();
        dragStartY = e.clientY;
        dragOffsetY = e.clientY - rect.top;

        // Create placeholder
        dragPlaceholder = document.createElement('div');
        dragPlaceholder.className = 'zorder-placeholder';
        dragPlaceholder.style.height = `${rect.height}px`;
        dragItem.parentElement!.insertBefore(dragPlaceholder, dragItem);

        // Float the dragged item
        dragItem.classList.add('zorder-dragging');
        dragItem.style.position = 'fixed';
        dragItem.style.left = `${rect.left}px`;
        dragItem.style.top = `${rect.top}px`;
        dragItem.style.width = `${rect.width}px`;
        document.body.appendChild(dragItem);

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      const onMouseMove = (e: MouseEvent) => {
        if (!dragItem || !dragPlaceholder) return;
        e.preventDefault();
        const listRect = zList.getBoundingClientRect();
        dragItem.style.top = `${e.clientY - dragOffsetY}px`;

        // Find insertion point
        const items = Array.from(zList.querySelectorAll('.zorder-item, .zorder-placeholder'));
        for (const item of items) {
          if (item === dragPlaceholder) continue;
          const r = item.getBoundingClientRect();
          const mid = r.top + r.height / 2;
          if (e.clientY < mid) {
            zList.insertBefore(dragPlaceholder, item);
            return;
          }
        }
        // Past all items: append at end
        zList.appendChild(dragPlaceholder);
      };

      const onMouseUp = (_e: MouseEvent) => {
        if (!dragItem || !dragPlaceholder) return;

        // Determine new display index from placeholder position
        const items = Array.from(zList.querySelectorAll('.zorder-item, .zorder-placeholder'));
        const displayIdx = items.indexOf(dragPlaceholder);

        // Re-insert item into list at placeholder position
        dragItem.classList.remove('zorder-dragging');
        dragItem.style.position = '';
        dragItem.style.left = '';
        dragItem.style.top = '';
        dragItem.style.width = '';
        zList.insertBefore(dragItem, dragPlaceholder);
        dragPlaceholder.remove();

        const movedPhotoId = dragItem.dataset.photoId!;
        // Display is reversed: display index 0 = top of stack = last in array
        const newArrayIdx = allPhotos.length - 1 - displayIdx;
        overlay.reorderPhoto(movedPhotoId, newArrayIdx);

        dragItem = null;
        dragPlaceholder = null;

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      zSection.appendChild(zList);
      popup.appendChild(zSection);

      // 3. Move to section (if >1 section)
      if (sections.length > 1) {
        const moveSection = document.createElement('div');
        moveSection.className = 'gear-popup-section';
        const moveLabel = document.createElement('div');
        moveLabel.className = 'gear-popup-label';
        moveLabel.textContent = t('photos.sections.moveToSection');
        moveSection.appendChild(moveLabel);

        const moveActions = document.createElement('div');
        moveActions.className = 'gear-popup-actions';

        const currentSectionId = sections.find(s => s.photoIds.includes(photoId))?.id;
        for (const sec of sections) {
          if (sec.id === currentSectionId) continue;
          const btn = document.createElement('button');
          btn.className = 'gear-popup-move-btn';
          btn.textContent = sec.name;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Remove from current section
            for (const s of sections) {
              s.photoIds = s.photoIds.filter(id => id !== photoId);
            }
            // Add to target section
            sec.photoIds.push(photoId);
            saveSections(sections);
            closeGearPopup();
            refreshPhotoList();
          });
          moveActions.appendChild(btn);
        }
        moveSection.appendChild(moveActions);
        popup.appendChild(moveSection);
      }

      // 4. Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'gear-popup-delete-btn';
      deleteBtn.textContent = t('photos.delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeGearPopup();
        overlay.hidePhoto(photoId);
        showToast({
          message: t('photos.deleted', { name: photoName }),
          type: 'undo',
          duration: 5000,
          actionLabel: t('photos.undo'),
          onAction: () => {
            overlay.unhidePhoto(photoId);
          },
          onExpire: () => {
            overlay.removePhoto(photoId);
          },
        });
      });
      popup.appendChild(deleteBtn);
    }

    renderPopupContent();

    // Store refresh callback so z-order list updates on photo reorder
    currentGearPopupRefresh = renderPopupContent;

    // Position fixed relative to viewport so it's not clipped by panel overflow
    const rect = anchorItem.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.left = '';
    popup.style.right = '';
    // Align right edge with the anchor's right edge
    popup.style.right = `${window.innerWidth - rect.right}px`;
    popup.style.top = `${rect.bottom + 4}px`;

    document.body.appendChild(popup);

    // If popup goes below viewport, flip above the anchor
    requestAnimationFrame(() => {
      const popupRect = popup.getBoundingClientRect();
      if (popupRect.bottom > window.innerHeight) {
        popup.style.top = `${rect.top - popupRect.height - 4}px`;
      }
    });
  }

  refreshPhotoList();

  // ─── Unified search section ──────────────────────────────────────────────
  const { section: searchSection, content: searchContent } = makeSection(t('search.section'), false);

  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'dso-search-wrapper';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = t('search.placeholder');
  searchInput.className = 'star-search-input';

  const searchDropdown = document.createElement('div');
  searchDropdown.className = 'search-dropdown';

  searchWrapper.appendChild(searchInput);
  searchWrapper.appendChild(searchDropdown);
  searchContent.appendChild(searchWrapper);

  // Info panel (shown after selecting a star or DSO)
  const infoPanel = document.createElement('div');
  infoPanel.className = 'dso-info-panel';
  infoPanel.style.display = 'none';
  searchContent.appendChild(infoPanel);

  // Nearby stars panel
  const nearbyPanel = document.createElement('div');
  nearbyPanel.className = 'dso-nearby-panel';
  nearbyPanel.style.display = 'none';
  searchContent.appendChild(nearbyPanel);

  panel.appendChild(searchSection);

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

    infoPanel.innerHTML = `
      ${nameStr}
      <table class="dso-info-table">
        ${desigStr ? `<tr><td>${t('stars.designation')}</td><td>${desigStr}</td></tr>` : ''}
        ${flamStr ? `<tr><td>Flamsteed</td><td>${flamStr}</td></tr>` : ''}
        <tr><td>HIP</td><td>${star.hip}</td></tr>
        <tr><td>${t('stars.magnitude')}</td><td>${star.mag.toFixed(2)}</td></tr>
        ${star.constellation ? `<tr><td>${t('stars.constellation')}</td><td>${star.constellation}</td></tr>` : ''}
        <tr><td>RA</td><td>${raStr}</td></tr>
        <tr><td>${t('stars.dec')}</td><td>${decStr}</td></tr>
      </table>
    `;
    infoPanel.style.display = 'block';
    showNearbyStars(star.ra, star.dec);
  }

  function showDSOInfo(dso: DSO) {
    const typeName = getDSOTypeName(dso.type);
    const magStr = dso.mag !== null ? dso.mag.toFixed(1) : '—';
    const sizeStr = formatSize(dso.majAxis, dso.minAxis);
    const nameStr = dso.displayName ? `<div class="dso-info-name">${dso.displayName}</div>` : '';

    infoPanel.innerHTML = `
      ${nameStr}
      <table class="dso-info-table">
        <tr><td>${t('dso.type')}</td><td>${typeName}</td></tr>
        <tr><td>${t('stars.magnitude')}</td><td>${magStr}</td></tr>
        <tr><td>${t('dso.size')}</td><td>${sizeStr}</td></tr>
        <tr><td>${t('dso.raDec')}</td><td>${dso.ra.toFixed(2)}° / ${dso.dec.toFixed(2)}°</td></tr>
      </table>
    `;
    infoPanel.style.display = 'block';
    showNearbyStars(dso.ra, dso.dec);
  }

  function showNearbyStars(ra: number, dec: number) {
    const allStars = getStars();
    const nearby = allStars
      .filter(s => s.mag <= 6 && angularDistance(ra, dec, s.ra, s.dec) <= 5)
      .sort((a, b) => a.mag - b.mag)
      .slice(0, 5);

    if (nearby.length > 0) {
      nearbyPanel.innerHTML = `<div class="dso-nearby-title">${t('stars.nearbyTitle')}</div>`;
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

  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(async () => {
      const query = searchInput.value;
      if (!query || query.length < 1) {
        searchDropdown.innerHTML = '';
        searchDropdown.style.display = 'none';
        return;
      }
      const results = await searchUnified(query);
      if (searchInput.value !== query) return;
      searchDropdown.innerHTML = '';
      if (results.length === 0) {
        const noRes = document.createElement('div');
        noRes.className = 'search-item';
        noRes.innerHTML = `<span class="search-item-name" style="color:#88a">${t('search.noResults')}</span>`;
        searchDropdown.appendChild(noRes);
        searchDropdown.style.display = 'block';
        return;
      }
      searchDropdown.style.display = 'block';
      for (const result of results) {
        const item = document.createElement('div');
        item.className = 'search-item';
        const typeBadge = result.type === 'star'
          ? `<span class="search-item-type star">${t('search.typeStar')}</span>`
          : `<span class="search-item-type dso">${t('search.typeDSO')}</span>`;
        const magStr = result.mag < 90 ? `mag ${result.mag.toFixed(1)}` : '';
        item.innerHTML = `
          <span class="search-item-name">${typeBadge}${result.label}</span>
          <span class="search-item-mag">${magStr}</span>
        `;
        item.addEventListener('click', () => {
          searchInput.value = result.label;
          searchDropdown.style.display = 'none';
          skyMap.navigateTo(result.ra, result.dec, skyMap.getView().scale);
          if (result.type === 'star' && result.star) {
            showStarInfo(result.star);
          } else if (result.type === 'dso' && result.dso) {
            showDSOInfo(result.dso);
          }
        });
        searchDropdown.appendChild(item);
      }
    }, 250);
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => { searchDropdown.style.display = 'none'; }, 200);
  });

  searchInput.addEventListener('focus', () => {
    if (searchInput.value.length > 0) {
      searchInput.dispatchEvent(new Event('input'));
    }
  });

  // ─── DSO section (collapsible, closed by default) ──────────────────────────
  const { section: dsoSection, content: dsoContent } = makeSection(t('dso.section'), false);

  // Toggle checkbox
  const toggleRow = document.createElement('div');
  toggleRow.className = 'dso-toggle-row';
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'dso-toggle-label';
  const toggleCheck = document.createElement('input');
  toggleCheck.type = 'checkbox';
  toggleCheck.checked = settings.showDSOs;
  toggleLabel.appendChild(toggleCheck);
  toggleLabel.append(` ${t('dso.showDSOs')}`);
  toggleRow.appendChild(toggleLabel);
  dsoContent.appendChild(toggleRow);

  // DSO type sub-toggles
  const dsoTypeToggles = document.createElement('div');
  dsoTypeToggles.className = 'dso-type-toggles';
  const dsoTypeChecks: HTMLInputElement[] = [];

  const savedDsoTypes = new Set(settings.dsoTypes);

  for (const type of DSO_TYPES_ALL) {
    const label = t(`dso.typeLabels.${type}`);
    const typeRow = document.createElement('label');
    typeRow.className = 'dso-toggle-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = savedDsoTypes.has(type);
    cb.disabled = !settings.showDSOs;
    cb.dataset.dsoType = type;
    cb.addEventListener('change', () => {
      const types = new Set<string>();
      for (const c of dsoTypeChecks) {
        if (c.checked) types.add(c.dataset.dsoType!);
      }
      skyMap.setVisibleDSOTypes(types);
      settings.dsoTypes = [...types];
      saveSettings(settings);
    });
    dsoTypeChecks.push(cb);
    typeRow.appendChild(cb);
    typeRow.append(` ${label}`);
    dsoTypeToggles.appendChild(typeRow);
  }

  dsoContent.appendChild(dsoTypeToggles);

  // DSO catalog toggles
  const dsoCatalogToggles = document.createElement('div');
  dsoCatalogToggles.className = 'dso-catalog-toggles';
  const catalogTitle = document.createElement('div');
  catalogTitle.className = 'dso-catalog-toggles-title';
  catalogTitle.textContent = t('dso.catalogs');
  dsoCatalogToggles.appendChild(catalogTitle);

  const dsoCatalogChecks: HTMLInputElement[] = [];
  const savedDsoCatalogs = new Set(settings.dsoCatalogs);

  for (const cat of DSO_CATALOGS_ALL) {
    const label = t(`dso.catalogLabels.${cat}`);
    const catRow = document.createElement('label');
    catRow.className = 'dso-toggle-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = savedDsoCatalogs.has(cat);
    cb.disabled = !settings.showDSOs;
    cb.dataset.dsoCatalog = cat;
    cb.addEventListener('change', () => {
      const catalogs = new Set<string>();
      for (const c of dsoCatalogChecks) {
        if (c.checked) catalogs.add(c.dataset.dsoCatalog!);
      }
      skyMap.setVisibleDSOCatalogs(catalogs);
      settings.dsoCatalogs = [...catalogs];
      saveSettings(settings);
    });
    dsoCatalogChecks.push(cb);
    catRow.appendChild(cb);
    catRow.append(` ${label}`);
    dsoCatalogToggles.appendChild(catRow);
  }

  dsoContent.appendChild(dsoCatalogToggles);

  // Apply initial DSO visibility state
  if (!settings.showDSOs) {
    dsoTypeToggles.style.opacity = '0.4';
    dsoCatalogToggles.style.opacity = '0.4';
  }

  toggleCheck.addEventListener('change', () => {
    skyMap.setShowDSOs(toggleCheck.checked);
    settings.showDSOs = toggleCheck.checked;
    saveSettings(settings);
    for (const cb of dsoTypeChecks) {
      cb.disabled = !toggleCheck.checked;
    }
    for (const cb of dsoCatalogChecks) {
      cb.disabled = !toggleCheck.checked;
    }
    dsoTypeToggles.style.opacity = toggleCheck.checked ? '1' : '0.4';
    dsoCatalogToggles.style.opacity = toggleCheck.checked ? '1' : '0.4';
  });

  panel.appendChild(dsoSection);

  // ─── Display controls section (collapsible, open by default) ─────────────
  const { section: displaySection, content: displayContent } = makeSection(t('display.section'), true);

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

  displayContent.appendChild(makeCheckRow(t('display.showStars'), settings.showStars, (v) => {
    skyMap.setShowStars(v);
    settings.showStars = v;
    saveSettings(settings);
  }));
  displayContent.appendChild(makeCheckRow(t('display.constellationLines'), settings.showConstellationLines, (v) => {
    skyMap.setShowConstellationLines(v);
    settings.showConstellationLines = v;
    saveSettings(settings);
  }));
  displayContent.appendChild(makeCheckRow(t('display.constellationNames'), settings.showConstellationNames, (v) => {
    skyMap.setShowConstellationNames(v);
    settings.showConstellationNames = v;
    saveSettings(settings);
  }));
  displayContent.appendChild(makeCheckRow(t('display.starLabels'), settings.showStarLabels, (v) => {
    skyMap.setShowStarLabels(v);
    settings.showStarLabels = v;
    saveSettings(settings);
  }));
  const gridRow = makeCheckRow(t('display.raDecGrid'), settings.showGrid, (v) => {
    skyMap.setShowGrid(v);
    settings.showGrid = v;
    saveSettings(settings);
  });
  displayContent.appendChild(gridRow);
  displayContent.appendChild(makeCheckRow(t('display.photoOutlines'), settings.showPhotoOutlines, (v) => {
    skyMap.setShowPhotoOutlines(v);
    settings.showPhotoOutlines = v;
    saveSettings(settings);
  }));

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
  magSlider.value = String(settings.maxMagnitude);
  magSlider.className = 'display-controls-mag-slider';

  const magValue = document.createElement('span');
  magValue.className = 'display-controls-mag-value';
  magValue.textContent = settings.autoMagnitude
    ? skyMap.getEffectiveMaxMag().toFixed(1)
    : settings.maxMagnitude.toFixed(1);

  magSlider.addEventListener('input', () => {
    const v = parseFloat(magSlider.value);
    magValue.textContent = v.toFixed(1);
    skyMap.setMaxMag(v);
    settings.maxMagnitude = v;
    saveSettings(settings);
  });

  magLabelEl.append(`${t('display.maxMagnitude')} `);
  magRow.appendChild(magLabelEl);
  magRow.appendChild(magSlider);
  magRow.appendChild(magValue);
  displayContent.appendChild(magRow);

  // Apply auto magnitude initial state
  if (settings.autoMagnitude) {
    magSlider.disabled = true;
    magRow.style.opacity = '0.4';
  }

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

  displayContent.appendChild(makeSliderRow(t('display.skyOpacity'), 0, 1, 0.05, settings.skyOpacity, (v) => {
    skyMap.setSkyOpacity(v);
    settings.skyOpacity = v;
    saveSettings(settings);
  }));
  displayContent.appendChild(makeSliderRow(t('display.backgroundGradient'), 0, 1, 0.05, settings.backgroundOpacity, (v) => {
    skyMap.setBackgroundOpacity(v);
    settings.backgroundOpacity = v;
    saveSettings(settings);
  }));

  panel.appendChild(displaySection);

  // ─── Settings section (collapsible, open by default) ───────────────────────
  const { section: settingsSection, content: settingsContent } = makeSection(t('settings.section'), true);

  // Default photo opacity slider
  const photoOpRow = document.createElement('div');
  photoOpRow.className = 'display-controls-mag-row';
  const photoOpLabel = document.createElement('label');
  photoOpLabel.className = 'display-controls-mag-label';
  photoOpLabel.textContent = t('settings.defaultPhotoOpacity') + ' ';
  const photoOpSlider = document.createElement('input');
  photoOpSlider.type = 'range';
  photoOpSlider.min = '0';
  photoOpSlider.max = '1';
  photoOpSlider.step = '0.05';
  photoOpSlider.value = String(settings.defaultPhotoOpacity);
  photoOpSlider.className = 'display-controls-mag-slider';
  const photoOpValue = document.createElement('span');
  photoOpValue.className = 'display-controls-mag-value';
  photoOpValue.textContent = settings.defaultPhotoOpacity.toFixed(2);
  photoOpSlider.addEventListener('input', () => {
    const v = parseFloat(photoOpSlider.value);
    photoOpValue.textContent = v.toFixed(2);
    overlay.setDefaultOpacity(v);
    settings.defaultPhotoOpacity = v;
    saveSettings(settings);
  });
  photoOpRow.appendChild(photoOpLabel);
  photoOpRow.appendChild(photoOpSlider);
  photoOpRow.appendChild(photoOpValue);
  settingsContent.appendChild(photoOpRow);

  // Auto magnitude toggle
  const autoMagRow = makeCheckRow(t('settings.autoMagnitude'), settings.autoMagnitude, (v) => {
    settings.autoMagnitude = v;
    saveSettings(settings);
    if (v) {
      skyMap.setMaxMag(null);
      magSlider.disabled = true;
      magRow.style.opacity = '0.4';
      magValue.textContent = skyMap.getEffectiveMaxMag().toFixed(1);
    } else {
      const mag = parseFloat(magSlider.value);
      skyMap.setMaxMag(mag);
      magSlider.disabled = false;
      magRow.style.opacity = '1';
      magValue.textContent = mag.toFixed(1);
    }
  });
  settingsContent.appendChild(autoMagRow);

  panel.appendChild(settingsSection);

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
      lines.push(`${t('stars.magnitude')} : ${star.mag.toFixed(2)}`);
      if (star.constellation) {
        lines.push(`${t('stars.constellation')} : ${star.constellation}`);
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
      const typeName = getDSOTypeName(dso.type);
      const lines: string[] = [];
      lines.push(`<strong>${dso.id}</strong>`);
      if (dso.displayName) lines.push(dso.displayName);
      lines.push(typeName);
      if (dso.mag !== null) lines.push(`${t('stars.magnitude')} : ${dso.mag.toFixed(1)}`);
      const sizeStr = formatSize(dso.majAxis, dso.minAxis);
      if (sizeStr !== '—') lines.push(`${t('dso.size')} : ${sizeStr}`);
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
        settings.showGrid = newVal;
        saveSettings(settings);
        break;
      }
    }
  });

  // ─── Apply initial settings to SkyMap and PhotoOverlay ──────────────────────
  skyMap.setShowStars(settings.showStars);
  skyMap.setShowConstellationLines(settings.showConstellationLines);
  skyMap.setShowConstellationNames(settings.showConstellationNames);
  skyMap.setShowStarLabels(settings.showStarLabels);
  skyMap.setShowGrid(settings.showGrid);
  skyMap.setShowPhotoOutlines(settings.showPhotoOutlines);
  skyMap.setSkyOpacity(settings.skyOpacity);
  skyMap.setBackgroundOpacity(settings.backgroundOpacity);
  skyMap.setShowDSOs(settings.showDSOs);
  skyMap.setVisibleDSOTypes(new Set(settings.dsoTypes));
  skyMap.setVisibleDSOCatalogs(new Set(settings.dsoCatalogs));
  if (settings.autoMagnitude) {
    skyMap.setMaxMag(null);
  } else {
    skyMap.setMaxMag(settings.maxMagnitude);
  }
  overlay.setDefaultOpacity(settings.defaultPhotoOpacity);

  // ─── Hook into view change to update auto magnitude display ─────────────────
  const origOnViewChange = (skyMap as any)['onViewChange'] as (() => void) | null;
  skyMap.setOnViewChange(() => {
    origOnViewChange?.();
    if (settings.autoMagnitude) {
      magValue.textContent = skyMap.getEffectiveMaxMag().toFixed(1);
    }
  });
}
