[Version française](README.fr.md)

# Star Sky Map

[![CI](https://github.com/vemore/star-photo-map/actions/workflows/ci.yml/badge.svg)](https://github.com/vemore/star-photo-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An interactive web application for overlaying astrophotographs onto a celestial map.

Users upload a photo of the night sky and the application automatically positions it on the map using a plate solver (local or online). The photo is displayed with the correct rotation, scale, and position thanks to an affine transform computed by least squares fitting.

---

## Features

**Interactive sky map**
- ~41,000 stars (up to mag 8) with B-V colors, constellation lines, names in French/English, RA/Dec grid
- 10,634 deep sky objects (OpenNGC + SH2 nebulae): galaxies, clusters, nebulae, planetary nebulae
- Stereographic polar projection — North Celestial Pole at center, equator at the edge
- Zoom & pan (scroll wheel + click-drag), faint stars appear progressively
- Hover tooltips: name, magnitude, constellation; detailed info panel for DSOs
- Bilingual interface French/English (FR|EN selector)

**Plate solving — 4 methods**
- *Local ASTAP* — professional solver as server subprocess, results in seconds
- *Astrometry.net* — online submission, polling until result
- *Local solve* — star triangulation (hash index) on the client side
- *WCS metadata* — direct read from embedded FITS/TIFF headers

**Placement & alignment**
- Manual placement: semi-transparent draggable photo, rotation/zoom sliders, mirror X/Y
- 2-point placement (similarity transform) or 3-point placement (affine)
- Direct RA/Dec coordinate input as an alternative to star search
- Least-squares affine fit on up to 9 reference stars

**Settings & persistence**
- Express backend + SQLite, photos and correspondences stored on disk
- All display settings persisted in localStorage across sessions
- Configurable default photo opacity and auto magnitude (zoom-adaptive)

---

## Tech stack

| Component | Technology |
|---|---|
| Frontend | Vite + vanilla TypeScript, HTML5 Canvas |
| Backend | Express.js + TypeScript (tsx) |
| Database | SQLite (better-sqlite3) |
| Upload | Multer + Sharp (max 2048px resize) |
| Sky data | d3-celestial (GeoJSON), OpenNGC |
| Local plate solver | ASTAP CLI (`astap_cli` + D20 catalog) |
| CI | GitHub Actions (type-check + build) |

---

## Quick start

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Runs the Vite dev server (port 5173) and Express server (port 3001) in parallel.

> http://localhost:5173

### Production

```bash
npm run build
npx tsx server/index.ts
```

> http://localhost:3001

### Docker

```bash
docker compose up --build
```

> http://localhost:3001

---

## ASTAP installation (optional)

The local ASTAP solver requires the `astap_cli` binary and the D20 star catalog (~400 MB):

```bash
sudo bash scripts/install-astap.sh
```

The script installs everything to `/opt/astap/`. For a custom path, set the `ASTAP_PATH` environment variable before starting the server.

---

## Project structure

```
src/
  main.ts              # Frontend entry point
  i18n/                # Internationalization module (FR/EN)
  sky-map.ts           # Canvas rendering (stars, DSOs, constellations, grid)
  photo-overlay.ts     # Upload, registration modal, manual placement
  dso-catalog.ts       # DSO catalog loading and access
  plate-solver.ts      # Local plate solving by triangulation (hash index)
  projection.ts        # Stereographic polar projection
  affine.ts            # Exact affine fit (3 pts) and least squares (N pts)
  star-catalog.ts      # Star catalog loading
  search.ts            # Star and DSO search by name
  api.ts               # HTTP client (upload, plate solving, ASTAP)
  ui.ts                # Side panel, DSO section, tooltips
  types.ts             # TypeScript interfaces
  style.css            # Styles
server/
  index.ts             # Express server, API routes
  db.ts                # SQLite schema and queries
  astap.ts             # ASTAP integration (local subprocess)
  astrometry.ts        # Astrometry.net integration (remote plate solving)
  wcs-reader.ts        # WCS reading, TAN projection → correspondences
  star-search.ts       # Extended star search (deep catalog)
public/data/
  stars.8.json         # ~41,000 stars up to mag 8 (d3-celestial)
  dso.json             # 10,634 DSOs (OpenNGC + SH2, compact columnar format)
  constellations.lines.json
  constellations.json
  starnames.json
scripts/
  install-astap.sh     # ASTAP CLI + D20 catalog download
  generate-dso.mjs     # Generate public/data/dso.json from OpenNGC
```

---

## API

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/photos` | Upload photo + correspondences (multipart) |
| `GET` | `/api/photos` | List all photos |
| `DELETE` | `/api/photos/:id` | Delete a photo |
| `POST` | `/api/solve-astap` | Local ASTAP plate solving (multipart) |
| `POST` | `/api/solve-wcs` | WCS metadata extraction (multipart) |
| `POST` | `/api/solve-plate` | Submit Astrometry.net job |
| `GET` | `/api/solve-plate/:id` | Astrometry.net job status and result |
| `GET` | `/api/stars/search` | Search stars by name |
| `GET` | `/api/stars/:hip` | Star details by HIP number |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Express server port |
| `DB_PATH` | `./data.db` | SQLite database path |
| `ASTAP_PATH` | `/opt/astap/astap_cli` | ASTAP binary path |
| `ASTROMETRY_API_KEY` | — | Astrometry.net API key (optional) |

---

## License

[MIT](LICENSE) — Vincent Moreau
