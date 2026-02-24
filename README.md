# Carte du Ciel Étoilé

Application web interactive pour superposer des astrophotographies sur une carte céleste.

L'utilisateur uploade une photo du ciel nocturne, et l'application la positionne automatiquement sur la carte grâce à un plate solver intégré (ou manuellement via identification de 3 étoiles). La photo est alors affichée avec la bonne rotation, échelle et position grâce à une transformation affine.

## Fonctionnalités

- **Carte céleste interactive** — ~41 000 étoiles (jusqu'à mag 8) avec couleurs (indice B-V), constellations, grille RA/Dec, couverture complète du ciel
- **Projection stéréographique polaire** — Pôle Nord Céleste au centre, équateur au bord
- **Plate solving automatique** — Résolution locale par triangulation (hash de triangles d'étoiles) ou via Astrometry.net
- **Upload de photos** — Positionnement automatique ou manuel (identification de 3 étoiles par recherche)
- **Positionnement précis** — Transformation affine 3 points → CSS `matrix()`
- **Zoom & pan** — Molette + clic-glisser, étoiles faibles apparaissent progressivement
- **Tooltips** — Nom, magnitude et constellation au survol des étoiles
- **Persistance** — Backend Express + SQLite, photos stockées sur disque

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Frontend | Vite + TypeScript vanilla, HTML5 Canvas |
| Backend | Express.js + TypeScript (tsx) |
| Base de données | SQLite (better-sqlite3) |
| Upload | Multer + Sharp (redimensionnement) |
| Données célestes | d3-celestial (GeoJSON) |

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

## Structure du projet

```
src/
  main.ts              # Point d'entrée frontend
  sky-map.ts           # Rendu Canvas (étoiles, constellations, grille)
  photo-overlay.ts     # Upload, marquage, positionnement photos
  plate-solver.ts      # Résolution locale par triangulation (hash index)
  projection.ts        # Projection stéréographique polaire
  affine.ts            # Transformation affine 3 points → CSS matrix
  star-catalog.ts      # Chargement des données célestes
  search.ts            # Recherche d'étoiles par nom
  api.ts               # Client HTTP
  ui.ts                # Panneau latéral, tooltips, events
  types.ts             # Interfaces TypeScript
  style.css            # Styles
server/
  index.ts             # Serveur Express, routes API
  db.ts                # Schéma SQLite et requêtes
  astrometry.ts        # Intégration Astrometry.net (plate solving distant)
  wcs-reader.ts        # Lecture des solutions WCS
public/data/
  stars.8.json         # ~41 000 étoiles jusqu'à mag 8 (d3-celestial)
  constellations.lines.json
  constellations.json
  starnames.json
```

## API

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/photos` | Upload photo + 3 correspondances (multipart) |
| `GET` | `/api/photos` | Liste toutes les photos |
| `DELETE` | `/api/photos/:id` | Supprime une photo |
| `GET` | `/uploads/:filename` | Sert les fichiers photos |
