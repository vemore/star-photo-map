# Carte du Ciel Étoilé

Application web interactive pour superposer des astrophotographies sur une carte céleste.

L'utilisateur uploade une photo du ciel nocturne et l'application la positionne automatiquement sur la carte grâce à un plate solver (local ou en ligne). La photo est affichée avec la bonne rotation, échelle et position grâce à une transformation affine calculée par moindres carrés.

## Fonctionnalités

- **Carte céleste interactive** — ~41 000 étoiles (jusqu'à mag 8) avec couleurs B-V, lignes de constellations, noms, grille RA/Dec, couverture complète du ciel
- **Projection stéréographique polaire** — Pôle Nord Céleste au centre, équateur au bord
- **Catalogue DSO** — 10 634 objets (OpenNGC + nébuleuses SH2) : galaxies, amas, nébuleuses, nébuleuses planétaires — rendu par type, labels à l'échelle, recherche + fiche détaillée
- **Plate solving — 4 méthodes** :
  - *ASTAP local* — solveur professionnel en sous-processus serveur (`astap_cli`), résultats en quelques secondes
  - *Astrometry.net* — soumission en ligne, polling jusqu'au résultat
  - *Résolution locale* — triangulation d'étoiles (hash index) côté client
  - *Métadonnées WCS* — lecture directe depuis FITS/TIFF embarqués
- **Placement manuel** — photo semi-transparente draggable sur la carte, curseurs rotation/zoom, validation par 3 coins
- **Alignement précis** — fit affine par moindres carrés sur jusqu'à 9 étoiles de référence (vs. 3 auparavant), réduisant l'erreur de rotation à haute déclinaison
- **Zoom & pan** — molette + clic-glisser, étoiles faibles apparaissent progressivement
- **Tooltips** — nom, magnitude, constellation au survol des étoiles ; fiche DSO au survol des objets
- **Persistance** — Backend Express + SQLite, photos et correspondances stockées sur disque

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Frontend | Vite + TypeScript vanilla, HTML5 Canvas |
| Backend | Express.js + TypeScript (tsx) |
| Base de données | SQLite (better-sqlite3) |
| Upload | Multer + Sharp (redimensionnement max 2048 px) |
| Données célestes | d3-celestial (GeoJSON), OpenNGC |
| Plate solver local | ASTAP CLI (`astap_cli` + catalogue D20) |

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

Ouvrir http://localhost:5173

### Production

```bash
npm run build
npx tsx server/index.ts
```

Ouvrir http://localhost:3001

### Docker

```bash
docker compose up --build
```

Ouvrir http://localhost:3001

## Installation d'ASTAP (optionnel)

Le solveur ASTAP local nécessite le binaire `astap_cli` et le catalogue d'étoiles D20 (~400 Mo) :

```bash
sudo bash scripts/install-astap.sh
```

Le script installe tout dans `/opt/astap/`. Pour un chemin personnalisé, définir la variable d'environnement `ASTAP_PATH` avant de lancer le serveur.

## Structure du projet

```
src/
  main.ts              # Point d'entrée frontend
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
  wcs-reader.ts        # Lecture WCS, projection TAN → correspondances (jusqu'à 9)
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

## API

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/photos` | Upload photo + correspondances (multipart) |
| `GET` | `/api/photos` | Liste toutes les photos |
| `DELETE` | `/api/photos/:id` | Supprime une photo |
| `POST` | `/api/solve-astap` | Plate solving ASTAP local (multipart) |
| `POST` | `/api/solve-wcs` | Extraction métadonnées WCS (multipart) |
| `POST` | `/api/submit-job` | Soumission job Astrometry.net |
| `GET` | `/api/job-status/:jobId` | Statut et résultat Astrometry.net |
| `GET` | `/uploads/:filename` | Sert les fichiers photos |
