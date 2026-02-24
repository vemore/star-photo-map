import type { Photo, PhotoCorrespondence, Star, Point, ViewState } from './types';
import { project, toCanvas } from './projection';
import { computeAffineTransform, affineToCSS } from './affine';
import { getStarByHip } from './star-catalog';
import { searchStars } from './search';
import { uploadPhoto, deletePhotoAPI, solveWCS, submitPlateSolve, pollPlateSolve } from './api';
import { detectStarsFromFile } from './star-detector';
import { solvePlate } from './plate-solver';
import type { SkyMap } from './sky-map';

const MARKER_COLORS = ['#ff4444', '#44cc44', '#4488ff'];

interface PlacedPhoto {
  photo: Photo;
  imgEl: HTMLImageElement;
  visible: boolean;
}

function starDisplayLabel(star: Star): string {
  if (star.name) {
    if (star.bayer && star.constellation) {
      return `${star.name} (${star.bayer} ${star.constellation})`;
    }
    return star.name;
  }
  if (star.desig && star.constellation) {
    return `${star.desig} ${star.constellation}`;
  }
  if (star.flam && star.constellation) {
    return `${star.flam} ${star.constellation}`;
  }
  return `HIP ${star.hip} (${star.constellation || '?'}, mag ${star.mag.toFixed(1)})`;
}

export class PhotoOverlay {
  private container: HTMLDivElement;
  private placedPhotos: PlacedPhoto[] = [];
  private getView: () => ViewState;
  private skyMap: SkyMap | null;
  private onPhotosChanged: (() => void) | null = null;

  constructor(container: HTMLDivElement, getView: () => ViewState, skyMap?: SkyMap) {
    this.container = container;
    this.getView = getView;
    this.skyMap = skyMap || null;
  }

  setOnPhotosChanged(cb: () => void) {
    this.onPhotosChanged = cb;
  }

  /** Load photos from server and display them */
  loadPhotos(photos: Photo[]) {
    for (const photo of photos) {
      this.addPhotoToMap(photo);
    }
  }

  /** Recalculate all photo transforms (call on zoom/pan/resize) */
  updateTransforms() {
    const view = this.getView();
    for (const placed of this.placedPhotos) {
      if (!placed.visible) continue;
      this.applyTransform(placed, view);
    }
  }

  getPlacedPhotos(): PlacedPhoto[] {
    return this.placedPhotos;
  }

  toggleVisibility(photoId: string) {
    const placed = this.placedPhotos.find(p => p.photo.id === photoId);
    if (!placed) return;
    placed.visible = !placed.visible;
    placed.imgEl.style.display = placed.visible ? 'block' : 'none';
    if (placed.visible) {
      this.applyTransform(placed, this.getView());
    }
  }

  async removePhoto(photoId: string) {
    await deletePhotoAPI(photoId);
    const idx = this.placedPhotos.findIndex(p => p.photo.id === photoId);
    if (idx >= 0) {
      this.placedPhotos[idx].imgEl.remove();
      this.placedPhotos.splice(idx, 1);
    }
    this.onPhotosChanged?.();
  }

  /** Open the registration modal for a new photo */
  openRegistrationModal() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.tif,.tiff,.fits,.fit';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) this.showModal(file);
    };
    input.click();
  }

  private addPhotoToMap(photo: Photo) {
    const img = document.createElement('img');
    img.src = `/uploads/${photo.filename}`;
    img.className = 'photo-overlay-img';
    img.draggable = false;
    this.container.appendChild(img);

    const placed: PlacedPhoto = { photo, imgEl: img, visible: true };
    this.placedPhotos.push(placed);

    img.onload = () => {
      this.applyTransform(placed, this.getView());
    };
  }

  private applyTransform(placed: PlacedPhoto, view: ViewState) {
    const { photo, imgEl } = placed;
    if (photo.correspondences.length < 3) return;

    const photoPoints: [Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    const canvasPoints: [Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];

    for (const corr of photo.correspondences) {
      const star = getStarByHip(corr.starHip);
      if (!star) continue;

      const proj = project(star.ra, star.dec);
      const canvasPt = toCanvas(proj.x, proj.y, view);

      photoPoints[corr.pointIndex] = { x: corr.photoX, y: corr.photoY };
      canvasPoints[corr.pointIndex] = canvasPt;
    }

    try {
      const matrix = computeAffineTransform(photoPoints, canvasPoints);
      imgEl.style.transform = affineToCSS(matrix);
    } catch {
      // Points colinear - hide
      imgEl.style.display = 'none';
    }
  }

  private showModal(file: File) {
    // State
    const points: (PhotoCorrespondence | null)[] = [null, null, null];
    let activeIndex = 0;
    let naturalWidth = 0;
    let naturalHeight = 0;

    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal';

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `
      <h2>Ajouter une photo sur la carte</h2>
      <button class="modal-close">&times;</button>
    `;
    modal.appendChild(header);

    header.querySelector('.modal-close')!.addEventListener('click', () => {
      backdrop.remove();
    });

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';

    // Left: photo
    const photoSide = document.createElement('div');
    photoSide.className = 'modal-photo-side';

    const photoContainer = document.createElement('div');
    photoContainer.className = 'modal-photo-container';

    const photoImg = document.createElement('img');
    photoImg.className = 'modal-photo';
    photoContainer.appendChild(photoImg);
    photoSide.appendChild(photoContainer);

    // Right: form
    const formSide = document.createElement('div');
    formSide.className = 'modal-form-side';

    const instructions = document.createElement('p');
    instructions.className = 'modal-instructions';
    instructions.textContent = 'Cliquez sur 3 étoiles dans la photo, puis identifiez chacune.';
    formSide.appendChild(instructions);

    // --- Auto-solve section ---
    const fileExt = file.name.toLowerCase().replace(/^.*(\.[^.]+)$/, '$1');
    const isAstroFile = ['.tif', '.tiff', '.fits', '.fit'].includes(fileExt);

    const autoSection = document.createElement('div');
    autoSection.className = 'auto-solve-section';

    const autoTitle = document.createElement('div');
    autoTitle.className = 'auto-solve-title';
    autoTitle.textContent = 'Résolution automatique';
    autoSection.appendChild(autoTitle);

    const autoBtns = document.createElement('div');
    autoBtns.className = 'auto-solve-buttons';

    // WCS button (only for TIFF/FITS)
    const btnWCS = document.createElement('button');
    btnWCS.type = 'button';
    btnWCS.className = 'btn-auto-solve';
    btnWCS.textContent = 'Métadonnées (WCS)';
    btnWCS.disabled = !isAstroFile;
    btnWCS.title = isAstroFile ? 'Lire les données WCS du fichier' : 'Disponible pour les fichiers TIFF/FITS';
    autoBtns.appendChild(btnWCS);

    // Online button
    const btnOnline = document.createElement('button');
    btnOnline.type = 'button';
    btnOnline.className = 'btn-auto-solve';
    btnOnline.textContent = 'En ligne (astrometry.net)';
    autoBtns.appendChild(btnOnline);

    // Local solve button
    const btnLocal = document.createElement('button');
    btnLocal.type = 'button';
    btnLocal.className = 'btn-auto-solve full-width';
    btnLocal.textContent = 'Résoudre localement';
    autoBtns.appendChild(btnLocal);

    autoSection.appendChild(autoBtns);

    // Status area
    const autoStatus = document.createElement('div');
    autoStatus.className = 'auto-solve-status';
    autoSection.appendChild(autoStatus);

    formSide.appendChild(autoSection);

    // Separator
    const separator = document.createElement('div');
    separator.className = 'auto-solve-separator';
    separator.textContent = 'ou identification manuelle';
    formSide.appendChild(separator);

    // Helper: set auto-solve status
    function setAutoStatus(msg: string, state: 'solving' | 'success' | 'failed') {
      autoStatus.className = `auto-solve-status visible ${state}`;
      if (state === 'solving') {
        autoStatus.innerHTML = `<span class="auto-solve-spinner"></span>${msg}`;
      } else {
        autoStatus.textContent = msg;
      }
    }

    function disableAutoButtons() {
      btnWCS.disabled = true;
      btnOnline.disabled = true;
      btnLocal.disabled = true;
    }

    function enableAutoButtons() {
      btnWCS.disabled = !isAstroFile;
      btnOnline.disabled = false;
      btnLocal.disabled = false;
    }

    // 3 point entries
    const pointEntries: HTMLDivElement[] = [];
    const searchInputs: HTMLInputElement[] = [];
    const dropdowns: HTMLDivElement[] = [];
    const statusLabels: HTMLSpanElement[] = [];
    const pickBtns: HTMLButtonElement[] = [];

    for (let i = 0; i < 3; i++) {
      const entry = document.createElement('div');
      entry.className = 'point-entry';
      entry.dataset.index = String(i);

      const markerDot = document.createElement('span');
      markerDot.className = 'marker-dot';
      markerDot.style.backgroundColor = MARKER_COLORS[i];
      markerDot.textContent = String(i + 1);

      const info = document.createElement('div');
      info.className = 'point-info';

      const status = document.createElement('span');
      status.className = 'point-status';
      status.textContent = i === 0 ? 'Cliquez sur la photo...' : 'En attente';
      statusLabels.push(status);

      const searchWrapper = document.createElement('div');
      searchWrapper.className = 'search-wrapper';
      searchWrapper.style.display = 'none';

      const searchRow = document.createElement('div');
      searchRow.className = 'search-row';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Rechercher une étoile...';
      searchInput.className = 'star-search-input';
      searchInputs.push(searchInput);

      searchRow.appendChild(searchInput);

      // "Carte" pick button (only if skyMap available)
      if (this.skyMap) {
        const pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.className = 'btn-pick-map';
        pickBtn.title = 'Choisir sur la carte';
        pickBtn.textContent = 'Carte';
        pickBtns.push(pickBtn);
        searchRow.appendChild(pickBtn);

        const skyMapRef = this.skyMap;
        pickBtn.addEventListener('click', () => {
          // Hide modal backdrop to reveal the map
          backdrop.style.display = 'none';

          skyMapRef.enterPickingMode((star: Star) => {
            skyMapRef.exitPickingMode();
            backdrop.style.display = '';
            selectStar(i, star, starDisplayLabel(star));
          });

          // Escape handler to cancel and re-show modal
          const escHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
              skyMapRef.exitPickingMode();
              backdrop.style.display = '';
              window.removeEventListener('keydown', escHandler);
            }
          };
          window.addEventListener('keydown', escHandler);
        });
      }

      const dropdown = document.createElement('div');
      dropdown.className = 'search-dropdown';
      dropdowns.push(dropdown);

      searchWrapper.appendChild(searchRow);
      searchWrapper.appendChild(dropdown);

      info.appendChild(status);
      info.appendChild(searchWrapper);

      entry.appendChild(markerDot);
      entry.appendChild(info);
      formSide.appendChild(entry);
      pointEntries.push(entry);

      // Search handler
      searchInput.addEventListener('input', () => {
        const results = searchStars(searchInput.value);
        dropdown.innerHTML = '';
        if (results.length === 0) {
          dropdown.style.display = 'none';
          return;
        }
        dropdown.style.display = 'block';
        for (const result of results) {
          const item = document.createElement('div');
          item.className = 'search-item';
          item.innerHTML = `
            <span class="search-item-name">${result.label}</span>
            <span class="search-item-mag">mag ${result.star.mag.toFixed(1)}</span>
          `;
          item.addEventListener('click', () => {
            selectStar(i, result.star, result.label);
            dropdown.style.display = 'none';
          });
          dropdown.appendChild(item);
        }
      });

      searchInput.addEventListener('blur', () => {
        setTimeout(() => { dropdown.style.display = 'none'; }, 200);
      });

      searchInput.addEventListener('focus', () => {
        if (searchInput.value.length > 0) {
          searchInput.dispatchEvent(new Event('input'));
        }
      });
    }

    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.className = 'modal-submit';
    submitBtn.textContent = 'Placer sur la carte';
    submitBtn.disabled = true;
    formSide.appendChild(submitBtn);

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-cancel';
    cancelBtn.textContent = 'Annuler';
    cancelBtn.addEventListener('click', () => backdrop.remove());
    formSide.appendChild(cancelBtn);

    body.appendChild(photoSide);
    body.appendChild(formSide);
    modal.appendChild(body);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Load image
    const url = URL.createObjectURL(file);
    photoImg.onload = () => {
      naturalWidth = photoImg.naturalWidth;
      naturalHeight = photoImg.naturalHeight;
      URL.revokeObjectURL(url);
    };
    photoImg.src = url;

    // Markers on photo
    const markers: HTMLDivElement[] = [];

    photoContainer.addEventListener('click', (e) => {
      if (activeIndex >= 3) return;

      const rect = photoImg.getBoundingClientRect();
      const displayX = e.clientX - rect.left;
      const displayY = e.clientY - rect.top;

      // Convert to natural image coordinates
      const scaleX = naturalWidth / photoImg.offsetWidth;
      const scaleY = naturalHeight / photoImg.offsetHeight;
      const natX = displayX * scaleX;
      const natY = displayY * scaleY;

      // Place marker
      placeMarker(activeIndex, displayX, displayY, natX, natY);
    });

    function placeMarker(idx: number, dispX: number, dispY: number, natX: number, natY: number) {
      // Remove existing marker for this index
      if (markers[idx]) markers[idx].remove();

      const marker = document.createElement('div');
      marker.className = 'photo-marker';
      marker.style.left = `${dispX}px`;
      marker.style.top = `${dispY}px`;
      marker.style.backgroundColor = MARKER_COLORS[idx];
      marker.textContent = String(idx + 1);
      photoContainer.appendChild(marker);
      markers[idx] = marker;

      // Update point
      points[idx] = {
        pointIndex: idx,
        photoX: natX,
        photoY: natY,
        starHip: 0,
        starName: '',
      };

      // Show search input
      const searchWrapper = pointEntries[idx].querySelector('.search-wrapper') as HTMLElement;
      searchWrapper.style.display = 'block';
      statusLabels[idx].textContent = `Position définie`;
      searchInputs[idx].focus();

      // Advance active index to next incomplete point
      updateActiveIndex();
    }

    function selectStar(idx: number, star: Star, label: string) {
      if (!points[idx]) return;
      points[idx]!.starHip = star.hip;
      points[idx]!.starName = label;
      statusLabels[idx].textContent = label;
      statusLabels[idx].className = 'point-status point-complete';
      searchInputs[idx].value = label;
      searchInputs[idx].disabled = true;
      pointEntries[idx].classList.add('complete');

      // Disable pick button if exists
      if (pickBtns[idx]) {
        pickBtns[idx].disabled = true;
      }

      updateActiveIndex();
      checkComplete();
    }

    function updateActiveIndex() {
      // Find first incomplete point
      for (let i = 0; i < 3; i++) {
        if (!points[i] || points[i]!.starHip === 0) {
          activeIndex = i;
          // Update instructions
          for (let j = 0; j < 3; j++) {
            if (j === i && (!points[j] || points[j]!.photoX === undefined)) {
              statusLabels[j].textContent = 'Cliquez sur la photo...';
            }
          }
          return;
        }
      }
      activeIndex = 3; // All done
    }

    function checkComplete() {
      const allDone = points.every(p => p && p.starHip !== 0);
      submitBtn.disabled = !allDone;
    }

    // --- Auto-solve: apply result ---
    function applyAutoSolveResult(correspondences: PhotoCorrespondence[]) {
      if (!naturalWidth || !naturalHeight) return;

      const scaleX = photoImg.offsetWidth / naturalWidth;
      const scaleY = photoImg.offsetHeight / naturalHeight;

      for (const corr of correspondences) {
        const idx = corr.pointIndex;
        if (idx < 0 || idx >= 3) continue;

        const dispX = corr.photoX * scaleX;
        const dispY = corr.photoY * scaleY;

        placeMarker(idx, dispX, dispY, corr.photoX, corr.photoY);

        const star = getStarByHip(corr.starHip);
        if (star) {
          selectStar(idx, star, corr.starName || starDisplayLabel(star));
        } else {
          // Star not in client catalog, use server-provided name
          if (!points[idx]) continue;
          points[idx]!.starHip = corr.starHip;
          points[idx]!.starName = corr.starName;
          statusLabels[idx].textContent = corr.starName;
          statusLabels[idx].className = 'point-status point-complete';
          searchInputs[idx].value = corr.starName;
          searchInputs[idx].disabled = true;
          pointEntries[idx].classList.add('complete');
          if (pickBtns[idx]) pickBtns[idx].disabled = true;
          updateActiveIndex();
          checkComplete();
        }
      }
    }

    // --- WCS button handler ---
    btnWCS.addEventListener('click', async () => {
      disableAutoButtons();
      setAutoStatus('Lecture des métadonnées WCS…', 'solving');

      try {
        const result = await solveWCS(file);
        if (result.success && result.correspondences) {
          setAutoStatus('Métadonnées WCS trouvées !', 'success');
          applyAutoSolveResult(result.correspondences);
        } else {
          setAutoStatus(result.error || 'Aucune donnée WCS trouvée', 'failed');
          enableAutoButtons();
        }
      } catch (err: any) {
        setAutoStatus(err.message, 'failed');
        enableAutoButtons();
      }
    });

    // --- Online solve button handler ---
    btnOnline.addEventListener('click', async () => {
      disableAutoButtons();
      const startTime = Date.now();
      let timerInterval: ReturnType<typeof setInterval> | null = null;

      function updateTimer() {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        setAutoStatus(`Résolution en cours… (${elapsed}s)`, 'solving');
      }

      updateTimer();
      timerInterval = setInterval(updateTimer, 1000);

      try {
        const { jobId } = await submitPlateSolve(file);

        // Poll with backoff
        const delays = [3000, 5000, 8000, 13000, 13000, 13000, 13000, 13000];
        let attempt = 0;

        while (attempt < delays.length) {
          await new Promise(r => setTimeout(r, delays[attempt]));
          attempt++;

          const status = await pollPlateSolve(jobId);

          if (status.status === 'solved' && status.correspondences) {
            if (timerInterval) clearInterval(timerInterval);
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            setAutoStatus(`Résolu en ${elapsed}s !`, 'success');
            applyAutoSolveResult(status.correspondences);
            return;
          } else if (status.status === 'failed' || status.status === 'timeout') {
            if (timerInterval) clearInterval(timerInterval);
            setAutoStatus(status.error || 'Résolution échouée', 'failed');
            enableAutoButtons();
            return;
          }
        }

        // Timeout
        if (timerInterval) clearInterval(timerInterval);
        setAutoStatus('Timeout : la résolution a pris trop de temps', 'failed');
        enableAutoButtons();
      } catch (err: any) {
        if (timerInterval) clearInterval(timerInterval);
        setAutoStatus(err.message, 'failed');
        enableAutoButtons();
      }
    });

    // --- Local solve button handler ---
    btnLocal.addEventListener('click', async () => {
      disableAutoButtons();
      setAutoStatus('Détection des étoiles…', 'solving');

      try {
        const detection = await detectStarsFromFile(file);
        const spotCount = detection.spots.length;

        if (spotCount < 3) {
          setAutoStatus('Pas assez d\'étoiles détectées dans l\'image', 'failed');
          enableAutoButtons();
          return;
        }

        setAutoStatus(`${spotCount} étoiles détectées. Recherche de correspondances…`, 'solving');

        // Use setTimeout to let the UI update before the CPU-heavy solve
        await new Promise(r => setTimeout(r, 50));

        const result = await solvePlate(detection.spots, detection.imageWidth, detection.imageHeight);

        if (result.success && result.correspondences) {
          // Scale correspondences from detection size to original image size
          const scaledCorrespondences = result.correspondences.map(c => ({
            ...c,
            photoX: c.photoX * detection.scaleFromOriginal,
            photoY: c.photoY * detection.scaleFromOriginal,
          }));
          setAutoStatus('Résolution locale réussie !', 'success');
          applyAutoSolveResult(scaledCorrespondences);
        } else {
          setAutoStatus(result.error || 'Aucune solution trouvée', 'failed');
          enableAutoButtons();
        }
      } catch (err: any) {
        setAutoStatus(err.message, 'failed');
        enableAutoButtons();
      }
    });

    submitBtn.addEventListener('click', async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Envoi en cours...';

      try {
        const correspondences = points.filter(Boolean) as PhotoCorrespondence[];
        const photo = await uploadPhoto(file, correspondences);
        this.addPhotoToMap(photo);
        this.onPhotosChanged?.();
        backdrop.remove();
      } catch (err: any) {
        alert(`Erreur : ${err.message}`);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Placer sur la carte';
      }
    });
  }
}
