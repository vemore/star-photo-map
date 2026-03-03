[English version](README.md)

# Carte du Ciel Étoilé

[![CI](https://github.com/vemore/star-photo-map/actions/workflows/ci.yml/badge.svg)](https://github.com/vemore/star-photo-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Application web interactive pour superposer des astrophotographies sur une carte céleste.

L'utilisateur uploade une photo du ciel nocturne et l'application la positionne automatiquement sur la carte grâce à un plate solver (local ou en ligne). La photo est affichée avec la bonne rotation, échelle et position grâce à une transformation affine calculée par moindres carrés.

---

## Fonctionnalités

**Carte céleste interactive**
- ~41 000 étoiles (jusqu'à mag 8) avec couleurs B-V, lignes de constellations, noms en français/anglais, grille RA/Dec
- 10 634 objets du ciel profond (OpenNGC + nébuleuses SH2) : galaxies, amas, nébuleuses, nébuleuses planétaires
- Projection stéréographique polaire — Pôle Nord Céleste au centre, équateur au bord
- Zoom & pan (molette + clic-glisser), étoiles faibles apparaissent progressivement
- Tooltips au survol : nom, magnitude, constellation ; fiche détaillée pour les DSOs
- Interface bilingue français/anglais (sélecteur FR|EN)

**Plate solving — 4 méthodes**
- *ASTAP local* — solveur professionnel en sous-processus serveur, résultats en quelques secondes
- *Astrometry.net* — soumission en ligne, polling jusqu'au résultat
- *Résolution locale* — triangulation d'étoiles (hash index) côté client
- *Métadonnées WCS* — lecture directe depuis FITS/TIFF embarqués

**Placement & alignement**
- Placement manuel : photo semi-transparente draggable, curseurs rotation/zoom, miroir X/Y
- Placement 2 points (transformation de similarité) ou 3 points (affine)
- Saisie directe de coordonnées RA/Déc en alternative à la recherche d'étoile
- Fit affine par moindres carrés sur jusqu'à 9 étoiles de référence

**Réglages & persistance**
- Backend Express + SQLite, photos et correspondances stockées sur disque
- Tous les paramètres d'affichage sauvegardés dans localStorage entre sessions
- Opacité par défaut des photos et magnitude auto (adaptive au zoom) configurables

---

## Stack technique

| Composant | Technologie |
|---|---|
| Frontend | Vite + TypeScript vanilla, HTML5 Canvas |
| Backend | Express.js + TypeScript (tsx) |
| Base de données | SQLite (better-sqlite3) |
| Upload | Multer + Sharp (redimensionnement max 2048 px) |
| Données célestes | d3-celestial (GeoJSON), OpenNGC |
| Plate solver local | ASTAP CLI (`astap_cli` + catalogue D20) |
| CI | GitHub Actions (type-check + build) |

---

## Démarrage rapide

### Prérequis

- Node.js 20+
- npm

### Installation

```bash
npm install
```

### Développement

```bash
npm run dev
```

Lance le serveur Vite (port 5173) et le serveur Express (port 3001) en parallèle.

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

## Installation d'ASTAP (optionnel)

Le solveur ASTAP local nécessite le binaire `astap_cli` et le catalogue d'étoiles D20 (~400 Mo) :

```bash
sudo bash scripts/install-astap.sh
```

Le script installe tout dans `/opt/astap/`. Pour un chemin personnalisé, définir la variable d'environnement `ASTAP_PATH` avant de lancer le serveur.

---

## Structure du projet

```
src/
  main.ts              # Point d'entrée frontend
  i18n/                # Module d'internationalisation (FR/EN)
  sky-map.ts           # Rendu Canvas (étoiles, DSOs, constellations, grille)
  photo-overlay.ts     # Upload, registration modal, placement manuel
  dso-catalog.ts       # Chargement et accès au catalogue DSO
  plate-solver.ts      # Résolution locale par triangulation (hash index)
  projection.ts        # Projection stéréographique polaire
  affine.ts            # Fit affine exact (3 pts) et moindres carrés (N pts)
  star-catalog.ts      # Chargement du catalogue d'étoiles
  search.ts            # Recherche d'étoiles et de DSOs par nom
  api.ts               # Client HTTP (upload, plate solving, ASTAP)
  ui.ts                # Panneau latéral, section DSO, tooltips
  types.ts             # Interfaces TypeScript
  style.css            # Styles
server/
  index.ts             # Serveur Express, routes API
  db.ts                # Schéma SQLite et requêtes
  astap.ts             # Intégration ASTAP (sous-processus local)
  astrometry.ts        # Intégration Astrometry.net (plate solving distant)
  wcs-reader.ts        # Lecture WCS, projection TAN → correspondances
  star-search.ts       # Recherche étoiles étendue (catalogue deep)
public/data/
  stars.8.json         # ~41 000 étoiles jusqu'à mag 8 (d3-celestial)
  dso.json             # 10 634 DSOs (OpenNGC + SH2, format colonnaire compact)
  constellations.lines.json
  constellations.json
  starnames.json
scripts/
  install-astap.sh     # Téléchargement ASTAP CLI + catalogue D20
  generate-dso.mjs     # Génération de public/data/dso.json depuis OpenNGC
```

---

## API

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/photos` | Upload photo + correspondances (multipart) |
| `GET` | `/api/photos` | Liste toutes les photos |
| `DELETE` | `/api/photos/:id` | Supprime une photo |
| `POST` | `/api/solve-astap` | Plate solving ASTAP local (multipart) |
| `POST` | `/api/solve-wcs` | Extraction métadonnées WCS (multipart) |
| `POST` | `/api/solve-plate` | Soumission job Astrometry.net |
| `GET` | `/api/solve-plate/:id` | Statut et résultat Astrometry.net |
| `GET` | `/api/stars/search` | Recherche d'étoiles par nom |
| `GET` | `/api/stars/:hip` | Détail d'une étoile par numéro HIP |

---

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3001` | Port du serveur Express |
| `DB_PATH` | `./data.db` | Chemin vers la base SQLite |
| `ASTAP_PATH` | `/opt/astap/astap_cli` | Chemin vers le binaire ASTAP |
| `ASTROMETRY_API_KEY` | — | Clé API Astrometry.net (optionnel) |

---

## Licence

[MIT](LICENSE) — Vincent Moreau
