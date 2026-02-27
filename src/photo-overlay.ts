import type { Photo, PhotoCorrespondence, Star, Point, ViewState, ManualPlacement } from './types';
import { project, toCanvas, unproject } from './projection';
import { computeAffineTransform, computeAffineLSQ, affineToCSS } from './affine';
import { getStarByHip, getStars } from './star-catalog';
import { uploadPhoto, deletePhotoAPI, solveWCS, submitPlateSolve, pollPlateSolve, solveWithASTAP, searchStarsAPI } from './api';
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
    this.onPhotosChanged?.();
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

  /** Compute the average RA/Dec center of a photo from its star correspondences */
  getPhotoCenter(photoId: string): { ra: number; dec: number } | null {
    const placed = this.placedPhotos.find(p => p.photo.id === photoId);
    if (!placed || placed.photo.correspondences.length === 0) return null;

    let sumX = 0, sumY = 0, count = 0;
    for (const corr of placed.photo.correspondences) {
      const star = getStarByHip(corr.starHip);
      if (!star) continue;
      const p = project(star.ra, star.dec);
      sumX += p.x;
      sumY += p.y;
      count++;
    }
    if (count === 0) return null;

    const avg = unproject(sumX / count, sumY / count);
    return { ra: avg.ra, dec: avg.dec };
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

  movePhotoUp(photoId: string) {
    const idx = this.placedPhotos.findIndex(p => p.photo.id === photoId);
    if (idx < 0 || idx >= this.placedPhotos.length - 1) return;
    [this.placedPhotos[idx], this.placedPhotos[idx + 1]] = [this.placedPhotos[idx + 1], this.placedPhotos[idx]];
    this.reorderDOM();
    this.onPhotosChanged?.();
  }

  movePhotoDown(photoId: string) {
    const idx = this.placedPhotos.findIndex(p => p.photo.id === photoId);
    if (idx <= 0) return;
    [this.placedPhotos[idx], this.placedPhotos[idx - 1]] = [this.placedPhotos[idx - 1], this.placedPhotos[idx]];
    this.reorderDOM();
    this.onPhotosChanged?.();
  }

  private reorderDOM() {
    for (const placed of this.placedPhotos) {
      this.container.appendChild(placed.imgEl);
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

    const photoPoints: Point[] = [];
    const canvasPoints: Point[] = [];

    for (const corr of photo.correspondences) {
      const star = getStarByHip(corr.starHip);
      if (!star) continue;

      const proj = project(star.ra, star.dec);
      const canvasPt = toCanvas(proj.x, proj.y, view);
      photoPoints.push({ x: corr.photoX, y: corr.photoY });
      canvasPoints.push(canvasPt);
    }

    if (photoPoints.length < 3) return;

    try {
      const matrix = photoPoints.length === 3
        ? computeAffineTransform(photoPoints as [Point, Point, Point], canvasPoints as [Point, Point, Point])
        : computeAffineLSQ(photoPoints, canvasPoints);
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
    // Extra correspondences (pointIndex >= 3) from auto-solve, used for LSQ fit
    let extraAutoCorrespondences: PhotoCorrespondence[] = [];

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

    // ASTAP local solve button
    const btnASTAP = document.createElement('button');
    btnASTAP.type = 'button';
    btnASTAP.className = 'btn-auto-solve';
    btnASTAP.textContent = 'ASTAP (local)';
    autoBtns.appendChild(btnASTAP);

    autoSection.appendChild(autoBtns);

    // Status area
    const autoStatus = document.createElement('div');
    autoStatus.className = 'auto-solve-status';
    autoSection.appendChild(autoStatus);

    formSide.appendChild(autoSection);

    // Manual placement button
    const manualSection = document.createElement('div');
    manualSection.className = 'manual-placement-section';

    const manualBtn = document.createElement('button');
    manualBtn.type = 'button';
    manualBtn.className = 'btn-auto-solve full-width';
    manualBtn.textContent = 'Placement manuel sur la carte';
    manualBtn.title = 'Glisser-déposer la photo sur la carte';
    manualSection.appendChild(manualBtn);
    formSide.appendChild(manualSection);

    manualBtn.addEventListener('click', () => {
      backdrop.remove();
      this.openManualPlacement(file);
    });

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
      btnASTAP.disabled = true;
    }

    function enableAutoButtons() {
      btnWCS.disabled = !isAstroFile;
      btnOnline.disabled = false;
      btnLocal.disabled = false;
      btnASTAP.disabled = false;
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

      // Search handler (async with debounce)
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      searchInput.addEventListener('input', () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          const query = searchInput.value;
          if (!query || query.length < 1) {
            dropdown.innerHTML = '';
            dropdown.style.display = 'none';
            return;
          }
          const results = await searchStarsAPI(query);
          // Ignore stale results
          if (searchInput.value !== query) return;
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
              <span class="search-item-mag">mag ${result.mag.toFixed(1)}</span>
            `;
            item.addEventListener('click', () => {
              const star: Star = {
                hip: result.hip, ra: result.ra, dec: result.dec,
                mag: result.mag, bv: result.bv,
                name: result.name, bayer: result.bayer, flam: result.flam,
                constellation: result.constellation, desig: result.desig,
              };
              selectStar(i, star, result.label);
              dropdown.style.display = 'none';
            });
            dropdown.appendChild(item);
          }
        }, 250);
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

      // Save extras (pointIndex >= 3) for LSQ fitting at upload time
      extraAutoCorrespondences = correspondences.filter(c => c.pointIndex >= 3);

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

    // --- ASTAP button handler ---
    btnASTAP.addEventListener('click', async () => {
      disableAutoButtons();
      setAutoStatus('Résolution ASTAP en cours…', 'solving');

      try {
        const result = await solveWithASTAP(file);

        if (result.success && result.correspondences && result.correspondences.length >= 3) {
          setAutoStatus('Résolu par ASTAP !', 'success');
          applyAutoSolveResult(result.correspondences);
        } else {
          setAutoStatus(result.error ?? 'Échec ASTAP', 'failed');
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
        const correspondences = [
          ...(points.filter(Boolean) as PhotoCorrespondence[]),
          ...extraAutoCorrespondences,
        ];
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

  /** Open manual placement mode: semi-transparent photo draggable on the map */
  openManualPlacement(file: File) {
    const view = this.getView();

    // Create preview img element
    const imgEl = document.createElement('img');
    imgEl.className = 'photo-overlay-img manual-placement-img';
    imgEl.style.opacity = '0.5';
    imgEl.style.pointerEvents = 'auto';
    imgEl.style.cursor = 'move';
    const objUrl = URL.createObjectURL(file);
    imgEl.src = objUrl;
    this.container.style.pointerEvents = 'auto';
    this.container.appendChild(imgEl);

    let naturalWidth = 0;
    let naturalHeight = 0;

    imgEl.onload = () => {
      naturalWidth = imgEl.naturalWidth;
      naturalHeight = imgEl.naturalHeight;
      redraw(this.getView());
    };

    // Placement state
    const placement: ManualPlacement = {
      centerRa: 0,
      centerDec: 60,
      rotationDeg: 0,
      projPerPx: 0.002,
    };

    // Initialize to current map center
    const initView = this.getView();
    const centerProj = { x: initView.centerX, y: initView.centerY };
    const centerSky = unproject(centerProj.x, centerProj.y);
    placement.centerRa = centerSky.ra;
    placement.centerDec = centerSky.dec;
    placement.projPerPx = 1 / initView.scale * 0.5;

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'manual-toolbar';
    toolbar.innerHTML = `
      <span class="manual-toolbar-label">Mode placement manuel</span>
      <label class="manual-toolbar-item">
        Rotation&nbsp;
        <input type="range" min="-180" max="180" value="0" step="1" class="manual-rotation-range">
        <span class="manual-rotation-val">0°</span>
      </label>
      <label class="manual-toolbar-item">
        Zoom photo&nbsp;
        <input type="range" min="-6" max="2" value="0" step="0.1" class="manual-zoom-range">
      </label>
      <div class="manual-toolbar-buttons">
        <button class="manual-validate-btn">Valider</button>
        <button class="manual-cancel-btn">Annuler</button>
      </div>
    `;
    document.body.appendChild(toolbar);

    const rotationRange = toolbar.querySelector('.manual-rotation-range') as HTMLInputElement;
    const rotationVal = toolbar.querySelector('.manual-rotation-val') as HTMLSpanElement;
    const zoomRange = toolbar.querySelector('.manual-zoom-range') as HTMLInputElement;
    const validateBtn = toolbar.querySelector('.manual-validate-btn') as HTMLButtonElement;
    const cancelBtn = toolbar.querySelector('.manual-cancel-btn') as HTMLButtonElement;

    const redraw = (v: ViewState) => {
      if (!naturalWidth || !naturalHeight) return;
      applyManualTransform(imgEl, placement, v, naturalWidth, naturalHeight);
    };

    // Hook into view changes via SkyMap's public setOnViewChange
    if (this.skyMap) {
      const origOnViewChange = (this.skyMap as any)['onViewChange'] as (() => void) | null;
      this.skyMap.setOnViewChange(() => {
        origOnViewChange?.();
        redraw(this.getView());
      });
    }

    // Drag on the image
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartRa = placement.centerRa;
    let dragStartDec = placement.centerDec;

    imgEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartRa = placement.centerRa;
      dragStartDec = placement.centerDec;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const v = this.getView();
      const dx = (e.clientX - dragStartX) / v.scale;
      const dy = (e.clientY - dragStartY) / v.scale;
      // Current center in projection
      const startProj = project(dragStartRa, dragStartDec);
      const newProj = { x: startProj.x + dx, y: startProj.y - dy };
      const newSky = unproject(newProj.x, newProj.y);
      placement.centerRa = newSky.ra;
      placement.centerDec = newSky.dec;
      redraw(v);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Scroll on image → zoom
    imgEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      placement.projPerPx *= factor;
      redraw(this.getView());
    }, { passive: false });

    // Rotation slider
    rotationRange.addEventListener('input', () => {
      placement.rotationDeg = parseFloat(rotationRange.value);
      rotationVal.textContent = `${placement.rotationDeg}°`;
      redraw(this.getView());
    });

    // Zoom slider (log scale)
    zoomRange.addEventListener('input', () => {
      const baseScale = 1 / this.getView().scale * 0.5;
      placement.projPerPx = baseScale * Math.pow(2, parseFloat(zoomRange.value));
      redraw(this.getView());
    });

    const cleanup = () => {
      imgEl.remove();
      toolbar.remove();
      URL.revokeObjectURL(objUrl);
      this.container.style.pointerEvents = 'none';
    };

    // Cancel
    cancelBtn.addEventListener('click', cleanup);

    // Validate
    validateBtn.addEventListener('click', async () => {
      if (!naturalWidth || !naturalHeight) return;
      validateBtn.disabled = true;
      validateBtn.textContent = 'Traitement…';

      try {
        const correspondences = buildSyntheticCorrespondences(placement, naturalWidth, naturalHeight);
        if (!correspondences) {
          alert('Impossible de trouver des étoiles de correspondance. Essayez de repositionner la photo.');
          validateBtn.disabled = false;
          validateBtn.textContent = 'Valider';
          return;
        }
        const photo = await uploadPhoto(file, correspondences);
        cleanup();
        this.addPhotoToMap(photo);
        this.onPhotosChanged?.();
      } catch (err: any) {
        alert(`Erreur : ${err.message}`);
        validateBtn.disabled = false;
        validateBtn.textContent = 'Valider';
      }
    });
  }
}

/** Apply manual placement CSS transform to imgEl */
function applyManualTransform(
  imgEl: HTMLImageElement,
  placement: ManualPlacement,
  view: ViewState,
  natW: number,
  natH: number,
): void {
  // Center of photo in canvas coords
  const centerProj = project(placement.centerRa, placement.centerDec);
  const centerCanvas = toCanvas(centerProj.x, centerProj.y, view);

  // Scale: projection units per pixel * view scale = canvas pixels per photo pixel
  const pxPerPx = placement.projPerPx * view.scale;

  // Rotation angle (convert PA to canvas angle)
  const rotRad = placement.rotationDeg * Math.PI / 180;

  // CSS matrix to map photo pixel (0,0) to canvas
  // The photo pixel (cx, cy) maps to center
  const cx = natW / 2;
  const cy = natH / 2;

  const cos = Math.cos(rotRad) * pxPerPx;
  const sin = Math.sin(rotRad) * pxPerPx;

  // matrix(a, b, c, d, e, f): maps (photoX, photoY) → canvas
  const a = cos;
  const b = sin;
  const c = -sin;
  const d = cos;
  const e = centerCanvas.x - cos * cx + sin * cy;
  const f = centerCanvas.y - sin * cx - cos * cy;

  imgEl.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
}

/** Build 3 synthetic PhotoCorrespondence from manual placement by finding nearest stars to photo corners */
function buildSyntheticCorrespondences(
  placement: ManualPlacement,
  natW: number,
  natH: number,
): PhotoCorrespondence[] | null {
  // Three representative photo points (corners/center arrangement)
  const photoPoints: [number, number][] = [
    [natW * 0.2, natH * 0.2],
    [natW * 0.8, natH * 0.2],
    [natW * 0.5, natH * 0.8],
  ];

  const centerProj = project(placement.centerRa, placement.centerDec);
  const pxPerPx = placement.projPerPx;
  const rotRad = placement.rotationDeg * Math.PI / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);
  const cx = natW / 2;
  const cy = natH / 2;

  const allStars = getStars().filter(s => s.mag <= 9);

  const correspondences: PhotoCorrespondence[] = [];

  for (let idx = 0; idx < 3; idx++) {
    const [px, py] = photoPoints[idx];
    // Map photo pixel → projection coords
    const dpx = px - cx;
    const dpy = py - cy;
    const projX = centerProj.x + (cos * dpx - sin * dpy) * pxPerPx;
    const projY = centerProj.y - (sin * dpx + cos * dpy) * pxPerPx;
    const sky = unproject(projX, projY);

    // Find nearest star
    let nearest: typeof allStars[0] | null = null;
    let minDist = Infinity;
    const toRad = Math.PI / 180;
    for (const star of allStars) {
      const d1 = sky.dec * toRad;
      const d2 = star.dec * toRad;
      const dra = (star.ra - sky.ra) * toRad;
      const cos2 = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dra);
      const dist = Math.acos(Math.max(-1, Math.min(1, cos2)));
      if (dist < minDist) {
        minDist = dist;
        nearest = star;
      }
    }

    if (!nearest) return null;

    // Back-project the star position to photo pixel coords
    const starProj = project(nearest.ra, nearest.dec);
    const dsprojX = starProj.x - centerProj.x;
    const dsprojY = starProj.y - centerProj.y;
    // Inverse rotation
    const dphotoX = (cos * dsprojX - sin * dsprojY) / pxPerPx;
    const dphotoY = -(sin * dsprojX + cos * dsprojY) / pxPerPx;
    const starPhotoX = cx + dphotoX;
    const starPhotoY = cy + dphotoY;

    correspondences.push({
      pointIndex: idx,
      photoX: starPhotoX,
      photoY: starPhotoY,
      starHip: nearest.hip,
      starName: nearest.name || nearest.desig || `HIP ${nearest.hip}`,
    });
  }

  return correspondences;
}
