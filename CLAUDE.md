# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm run dev          # Runs Vite (port 5173) + Express (port 3001) via concurrently
npm run dev:client   # Vite frontend only
npm run dev:server   # Express server with tsx watch (hot reload)
npm run build        # tsc type-check + vite build to dist/
npm run preview      # Preview production build
```

No test framework or linter is configured.

## Browser Testing

**Every code change must be verified in the browser before considering it done.** Use the Playwright MCP tools to test visually and interactively.

### Workflow

1. Start the dev server with `npm run dev` (runs Vite on port 5173 + Express on port 3001).
2. Navigate to `http://localhost:5173` using `browser_navigate`.
3. Take a snapshot (`browser_snapshot`) or screenshot (`browser_take_screenshot`) to verify the UI state.
4. Interact with the app (click, type, etc.) to test the modified feature.
5. Check the browser console (`browser_console_messages`) for errors or warnings.
6. **Fix any bug found during testing**, even if unrelated to the current task.

### What to verify

- No console errors or unhandled exceptions.
- UI renders correctly (layout, text, translations).
- Interactive features work (buttons, modals, search, canvas pan/zoom).
- Photos display and transform correctly on the sky map.
- Both FR and EN languages render properly if i18n was touched.

## Architecture

**Star Photo Map** is a web app for overlaying astrophotographs onto an interactive sky map. The frontend renders stars on an HTML5 Canvas using stereographic polar projection, while uploaded photos are positioned as DOM elements using CSS `transform: matrix()` computed from a 3-point affine registration.

### Frontend (`src/`)

- **Canvas layer** (`sky-map.ts`): Renders ~5000 stars with B-V color, constellation lines/names, RA/Dec grid. Handles zoom (wheel) and pan (drag). Fires `onViewChange` callback on every view update.
- **Photo layer** (`photo-overlay.ts`): Each photo is an `<img>` with absolute positioning and CSS matrix transform. On view change, all photo transforms are recomputed so they track the canvas. Manages the 3-point registration modal (user clicks photo pixel → searches for matching star).
- **Projection** (`projection.ts`): Stereographic polar projection with North Celestial Pole at center, celestial equator at r=1. `project(ra°, dec°)` → `(x, y)` in projection space; viewport transform converts to canvas pixels.
- **Affine** (`affine.ts`): Solves a 3×3 system from three (photo pixel → projection coord) pairs to produce the CSS matrix coefficients.
- **Star catalog** (`star-catalog.ts`): Loads d3-celestial JSON from `public/data/`, indexes stars by HIP number.
- **Search** (`search.ts`): Fuzzy star search by proper name, Bayer designation, or constellation with brightness boost.
- **API client** (`api.ts`): `uploadPhoto()` sends multipart form data (file + JSON correspondences), `getPhotos()`, `deletePhotoAPI()`.
- **UI** (`ui.ts`): Side panel with photo list, add/delete buttons, visibility toggles, star hover tooltips.

### Backend (`server/`)

Express 5 server with two files:

- **`index.ts`**: Routes — `POST /api/photos` (upload + resize via Sharp to max 2048px, scales correspondences), `GET /api/photos`, `DELETE /api/photos/:id`, static file serving for uploads and SPA fallback.
- **`db.ts`**: SQLite (better-sqlite3, WAL mode) with `photos` and `star_correspondences` tables. Photo + correspondences inserted in a transaction.

### Data Flow: Photo Upload

1. User clicks "Ajouter une photo" → file picker → registration modal
2. For each of 3 points: click on photo (pixel coords) → search star (HIP ID)
3. `POST /api/photos` sends file + correspondences as multipart form
4. Server resizes image, scales pixel coords proportionally, stores file in `uploads/` and metadata in SQLite
5. Frontend creates `<img>`, calls `computeAffineTransform()` with the 3 correspondence pairs, applies CSS `matrix()` transform
6. On zoom/pan, `SkyMap` fires `onViewChange` → `PhotoOverlay.updateTransforms()` recomputes all CSS matrices

### Key Types (`types.ts`)

`Star` (hip, ra, dec, mag, bv, name, bayer, constellation), `Photo` (id, filename, correspondences[]), `PhotoCorrespondence` (pointIndex, photoX, photoY, starHip, starName), `AffineMatrix` (a–f), `ViewState` (centerX, centerY, scale, width, height).

## Conventions

- **UI text is internationalized (FR/EN).** French is the default language. Translations live in `src/i18n/fr.ts` and `src/i18n/en.ts`. Use `t('key')` for all user-facing strings. Constellation/DSO names use `displayName` (populated per-language at load time).
- Vite proxies `/api` and `/uploads` to `http://localhost:3001` during dev.
- Backend reads `PORT` env var (default 3001) and `DB_PATH` (default `./data.db`).
- Uploaded photos go to `uploads/` directory on disk, named with UUIDs.
