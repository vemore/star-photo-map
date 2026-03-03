#!/usr/bin/env node
/**
 * generate-dso.mjs — Generates public/data/dso.json from OpenNGC + SH2 data.
 * Usage: node scripts/generate-dso.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../public/data/dso.json');

// ─── French names for well-known objects ────────────────────────────────────
const FRENCH_NAMES = {
  'M1':   'Nébuleuse du Crabe',
  'M2':   'Amas globulaire M2',
  'M3':   'Amas globulaire M3',
  'M4':   'Amas globulaire M4',
  'M5':   'Amas globulaire M5',
  'M6':   'Amas du Papillon',
  'M7':   'Amas de Ptolémée',
  'M8':   'Nébuleuse de la Lagune',
  'M9':   'Amas globulaire M9',
  'M10':  'Amas globulaire M10',
  'M11':  'Amas du Canard sauvage',
  'M12':  'Amas globulaire M12',
  'M13':  'Grand Amas d\'Hercule',
  'M14':  'Amas globulaire M14',
  'M15':  'Amas globulaire M15',
  'M16':  'Nébuleuse de l\'Aigle',
  'M17':  'Nébuleuse Oméga',
  'M18':  'Amas ouvert M18',
  'M19':  'Amas globulaire M19',
  'M20':  'Nébuleuse Trifide',
  'M21':  'Amas ouvert M21',
  'M22':  'Amas globulaire du Sagittaire',
  'M23':  'Amas ouvert M23',
  'M24':  'Nuage stellaire du Sagittaire',
  'M25':  'Amas ouvert M25',
  'M26':  'Amas ouvert M26',
  'M27':  'Nébuleuse de l\'Haltère',
  'M28':  'Amas globulaire M28',
  'M29':  'Amas ouvert M29',
  'M30':  'Amas globulaire M30',
  'M31':  'Galaxie d\'Andromède',
  'M32':  'Galaxie satellite d\'Andromède',
  'M33':  'Galaxie du Triangle',
  'M34':  'Amas ouvert M34',
  'M35':  'Amas ouvert M35',
  'M36':  'Amas de l\'Aurige',
  'M37':  'Amas ouvert M37',
  'M38':  'Amas ouvert M38',
  'M39':  'Amas ouvert M39',
  'M40':  'Winnecke 4',
  'M41':  'Amas ouvert M41',
  'M42':  'Nébuleuse d\'Orion',
  'M43':  'Nébuleuse de Mairan',
  'M44':  'Amas de la Crèche',
  'M45':  'Pléiades',
  'M46':  'Amas ouvert M46',
  'M47':  'Amas ouvert M47',
  'M48':  'Amas ouvert M48',
  'M49':  'Galaxie elliptique M49',
  'M50':  'Amas ouvert M50',
  'M51':  'Galaxie du Tourbillon',
  'M52':  'Amas ouvert M52',
  'M53':  'Amas globulaire M53',
  'M54':  'Amas globulaire M54',
  'M55':  'Amas globulaire M55',
  'M56':  'Amas globulaire M56',
  'M57':  'Nébuleuse de la Lyre',
  'M58':  'Galaxie spirale M58',
  'M59':  'Galaxie elliptique M59',
  'M60':  'Galaxie elliptique M60',
  'M61':  'Galaxie spirale M61',
  'M62':  'Amas globulaire M62',
  'M63':  'Galaxie du Tournesol',
  'M64':  'Galaxie Œil Noir',
  'M65':  'Galaxie spirale M65',
  'M66':  'Galaxie spirale M66',
  'M67':  'Amas ouvert M67',
  'M68':  'Amas globulaire M68',
  'M69':  'Amas globulaire M69',
  'M70':  'Amas globulaire M70',
  'M71':  'Amas globulaire M71',
  'M72':  'Amas globulaire M72',
  'M73':  'Astérisme M73',
  'M74':  'Galaxie fantôme',
  'M75':  'Amas globulaire M75',
  'M76':  'Petite Nébuleuse de l\'Haltère',
  'M77':  'Galaxie de Cetus',
  'M78':  'Nébuleuse par réflexion M78',
  'M79':  'Amas globulaire M79',
  'M80':  'Amas globulaire M80',
  'M81':  'Galaxie de Bode',
  'M82':  'Galaxie du Cigare',
  'M83':  'Galaxie du Moulinet Sud',
  'M84':  'Galaxie elliptique M84',
  'M85':  'Galaxie spirale M85',
  'M86':  'Galaxie elliptique M86',
  'M87':  'Galaxie de la Vierge',
  'M88':  'Galaxie spirale M88',
  'M89':  'Galaxie elliptique M89',
  'M90':  'Galaxie spirale M90',
  'M91':  'Galaxie spirale M91',
  'M92':  'Amas globulaire M92',
  'M93':  'Amas ouvert M93',
  'M94':  'Galaxie spirale M94',
  'M95':  'Galaxie spirale M95',
  'M96':  'Galaxie spirale M96',
  'M97':  'Nébuleuse du Hibou',
  'M98':  'Galaxie spirale M98',
  'M99':  'Galaxie spirale M99',
  'M100': 'Galaxie spirale M100',
  'M101': 'Galaxie du Moulinet',
  'M102': 'Galaxie fuseau',
  'M103': 'Amas ouvert M103',
  'M104': 'Galaxie du Sombrero',
  'M105': 'Galaxie elliptique M105',
  'M106': 'Galaxie spirale M106',
  'M107': 'Amas globulaire M107',
  'M108': 'Galaxie du Surf',
  'M109': 'Galaxie spirale M109',
  'M110': 'Galaxie naine elliptique M110',
  // NGC objects
  'NGC869':  'Double Amas de Persée h',
  'NGC884':  'Double Amas de Persée χ',
  'NGC1499': 'Nébuleuse de Californie',
  'NGC1977': 'Nébuleuse en émission NGC 1977',
  'NGC2024': 'Nébuleuse de la Flamme',
  'NGC2070': 'Nébuleuse de la Tarentule',
  'NGC2237': 'Nébuleuse de la Rosette',
  'NGC2244': 'Amas de la Rosette',
  'NGC2264': 'Amas de l\'Arbre de Noël',
  'NGC3372': 'Nébuleuse de la Carène',
  'NGC4594': 'Galaxie du Sombrero',
  'NGC5128': 'Galaxie Centaurus A',
  'NGC6357': 'Nébuleuse de la Patte de Loup',
  'NGC6514': 'Nébuleuse Trifide',
  'NGC6523': 'Nébuleuse de la Lagune',
  'NGC6618': 'Nébuleuse Oméga',
  'NGC6611': 'Nébuleuse de l\'Aigle',
  'NGC6720': 'Nébuleuse de la Lyre',
  'NGC6853': 'Nébuleuse de l\'Haltère',
  'NGC6992': 'Voile du Cygne Est',
  'NGC6960': 'Voile du Cygne Ouest',
  'NGC7000': 'Nébuleuse Amérique du Nord',
  'NGC7009': 'Nébuleuse de Saturne',
  'NGC7293': 'Nébuleuse de l\'Hélice',
  'NGC7331': 'Galaxie spirale NGC 7331',
  'NGC7789': 'Amas de la Rose de Caroline',
  'IC434':   'Nébuleuse de la Tête de Cheval',
  'IC1805':  'Nébuleuse du Cœur',
  'IC1848':  'Nébuleuse de l\'Âme',
  'IC2118':  'Nébuleuse Tête de Sorcière',
  'IC5070':  'Nébuleuse du Pélican',
  'IC5146':  'Nébuleuse du Cocon',
};

// ─── English names for well-known objects ───────────────────────────────────
const ENGLISH_NAMES = {
  'M1':   'Crab Nebula',
  'M2':   'Globular Cluster M2',
  'M3':   'Globular Cluster M3',
  'M4':   'Globular Cluster M4',
  'M5':   'Globular Cluster M5',
  'M6':   'Butterfly Cluster',
  'M7':   "Ptolemy's Cluster",
  'M8':   'Lagoon Nebula',
  'M9':   'Globular Cluster M9',
  'M10':  'Globular Cluster M10',
  'M11':  'Wild Duck Cluster',
  'M12':  'Globular Cluster M12',
  'M13':  'Great Hercules Cluster',
  'M14':  'Globular Cluster M14',
  'M15':  'Globular Cluster M15',
  'M16':  'Eagle Nebula',
  'M17':  'Omega Nebula',
  'M18':  'Open Cluster M18',
  'M19':  'Globular Cluster M19',
  'M20':  'Trifid Nebula',
  'M21':  'Open Cluster M21',
  'M22':  'Sagittarius Globular Cluster',
  'M23':  'Open Cluster M23',
  'M24':  'Sagittarius Star Cloud',
  'M25':  'Open Cluster M25',
  'M26':  'Open Cluster M26',
  'M27':  'Dumbbell Nebula',
  'M28':  'Globular Cluster M28',
  'M29':  'Open Cluster M29',
  'M30':  'Globular Cluster M30',
  'M31':  'Andromeda Galaxy',
  'M32':  'Andromeda Satellite Galaxy',
  'M33':  'Triangulum Galaxy',
  'M34':  'Open Cluster M34',
  'M35':  'Open Cluster M35',
  'M36':  'Auriga Cluster',
  'M37':  'Open Cluster M37',
  'M38':  'Open Cluster M38',
  'M39':  'Open Cluster M39',
  'M40':  'Winnecke 4',
  'M41':  'Open Cluster M41',
  'M42':  'Orion Nebula',
  'M43':  "De Mairan's Nebula",
  'M44':  'Beehive Cluster',
  'M45':  'Pleiades',
  'M46':  'Open Cluster M46',
  'M47':  'Open Cluster M47',
  'M48':  'Open Cluster M48',
  'M49':  'Elliptical Galaxy M49',
  'M50':  'Open Cluster M50',
  'M51':  'Whirlpool Galaxy',
  'M52':  'Open Cluster M52',
  'M53':  'Globular Cluster M53',
  'M54':  'Globular Cluster M54',
  'M55':  'Globular Cluster M55',
  'M56':  'Globular Cluster M56',
  'M57':  'Ring Nebula',
  'M58':  'Spiral Galaxy M58',
  'M59':  'Elliptical Galaxy M59',
  'M60':  'Elliptical Galaxy M60',
  'M61':  'Spiral Galaxy M61',
  'M62':  'Globular Cluster M62',
  'M63':  'Sunflower Galaxy',
  'M64':  'Black Eye Galaxy',
  'M65':  'Spiral Galaxy M65',
  'M66':  'Spiral Galaxy M66',
  'M67':  'Open Cluster M67',
  'M68':  'Globular Cluster M68',
  'M69':  'Globular Cluster M69',
  'M70':  'Globular Cluster M70',
  'M71':  'Globular Cluster M71',
  'M72':  'Globular Cluster M72',
  'M73':  'Asterism M73',
  'M74':  'Phantom Galaxy',
  'M75':  'Globular Cluster M75',
  'M76':  'Little Dumbbell Nebula',
  'M77':  'Cetus Galaxy',
  'M78':  'Reflection Nebula M78',
  'M79':  'Globular Cluster M79',
  'M80':  'Globular Cluster M80',
  'M81':  "Bode's Galaxy",
  'M82':  'Cigar Galaxy',
  'M83':  'Southern Pinwheel Galaxy',
  'M84':  'Elliptical Galaxy M84',
  'M85':  'Spiral Galaxy M85',
  'M86':  'Elliptical Galaxy M86',
  'M87':  'Virgo Galaxy',
  'M88':  'Spiral Galaxy M88',
  'M89':  'Elliptical Galaxy M89',
  'M90':  'Spiral Galaxy M90',
  'M91':  'Spiral Galaxy M91',
  'M92':  'Globular Cluster M92',
  'M93':  'Open Cluster M93',
  'M94':  'Spiral Galaxy M94',
  'M95':  'Spiral Galaxy M95',
  'M96':  'Spiral Galaxy M96',
  'M97':  'Owl Nebula',
  'M98':  'Spiral Galaxy M98',
  'M99':  'Spiral Galaxy M99',
  'M100': 'Spiral Galaxy M100',
  'M101': 'Pinwheel Galaxy',
  'M102': 'Spindle Galaxy',
  'M103': 'Open Cluster M103',
  'M104': 'Sombrero Galaxy',
  'M105': 'Elliptical Galaxy M105',
  'M106': 'Spiral Galaxy M106',
  'M107': 'Globular Cluster M107',
  'M108': 'Surfboard Galaxy',
  'M109': 'Spiral Galaxy M109',
  'M110': 'Dwarf Elliptical Galaxy M110',
  // NGC objects
  'NGC869':  'Double Cluster h Persei',
  'NGC884':  'Double Cluster χ Persei',
  'NGC1499': 'California Nebula',
  'NGC1977': 'Emission Nebula NGC 1977',
  'NGC2024': 'Flame Nebula',
  'NGC2070': 'Tarantula Nebula',
  'NGC2237': 'Rosette Nebula',
  'NGC2244': 'Rosette Cluster',
  'NGC2264': 'Christmas Tree Cluster',
  'NGC3372': 'Carina Nebula',
  'NGC4594': 'Sombrero Galaxy',
  'NGC5128': 'Centaurus A Galaxy',
  'NGC6357': 'Lobster Nebula',
  'NGC6514': 'Trifid Nebula',
  'NGC6523': 'Lagoon Nebula',
  'NGC6618': 'Omega Nebula',
  'NGC6611': 'Eagle Nebula',
  'NGC6720': 'Ring Nebula',
  'NGC6853': 'Dumbbell Nebula',
  'NGC6992': 'Eastern Veil Nebula',
  'NGC6960': 'Western Veil Nebula',
  'NGC7000': 'North America Nebula',
  'NGC7009': 'Saturn Nebula',
  'NGC7293': 'Helix Nebula',
  'NGC7331': 'Spiral Galaxy NGC 7331',
  'NGC7789': "Caroline's Rose Cluster",
  'IC434':   'Horsehead Nebula',
  'IC1805':  'Heart Nebula',
  'IC1848':  'Soul Nebula',
  'IC2118':  'Witch Head Nebula',
  'IC5070':  'Pelican Nebula',
  'IC5146':  'Cocoon Nebula',
};

// English names for SH2 objects with French names
const SH2_ENGLISH_NAMES = {
  'SH2-27':  'Zeta Ophiuchi Nebula',
  'SH2-86':  'NGC 6820 Nebula',
  'SH2-101': 'Tulip Nebula',
  'SH2-103': 'Cygnus Loop',
  'SH2-106': 'SH2-106 Nebula',
  'SH2-108': 'Crescent Nebula',
  'SH2-125': 'Cocoon Nebula IC 5146',
  'SH2-131': 'IC 1396 Nebula',
  'SH2-142': 'Spider Nebula',
  'SH2-147': 'Simeis 147 Nebula',
  'SH2-155': 'Cave Nebula',
  'SH2-185': 'IC 59/63 Nebula',
  'SH2-190': 'Starfish Nebula',
  'SH2-198': 'Heart Nebula IC 1805',
  'SH2-199': 'Soul Nebula IC 1848',
  'SH2-240': 'Pencil Nebula',
  'SH2-252': 'Monkey Head Nebula',
  'SH2-261': 'Octopus Nebula',
  'SH2-264': 'Lambda Orionis Nebula',
  'SH2-276': 'Extended Great Orion Nebula',
  'SH2-279': 'Running Man Nebula',
  'SH2-308': 'Zeta Puppis Starfish Nebula',
  'SH2-311': 'NGC 2467 Nebula',
};

// ─── SH2 catalogue (integrated data block) ──────────────────────────────────
// Format: [id, ra_deg, dec_deg, majAxis_arcmin, nameFr_or_null]
const SH2_DATA = [
  ['SH2-1',   245.94, -19.55, 30, null],
  ['SH2-2',   249.20, -24.57, 12, null],
  ['SH2-7',   253.40, -34.40, 25, null],
  ['SH2-11',  255.32, -40.65, 10, null],
  ['SH2-13',  257.41, -37.18, 14, null],
  ['SH2-16',  264.73, -29.76, 50, null],
  ['SH2-25',  267.59, -28.52, 20, null],
  ['SH2-27',  271.40, -13.24, 200, 'Nébuleuse de Zeta Ophiuchi'],
  ['SH2-29',  269.81, -19.20, 90, null],
  ['SH2-30',  270.86, -17.81, 25, null],
  ['SH2-37',  276.38, -1.73, 50, null],
  ['SH2-45',  279.96, 3.14, 15, null],
  ['SH2-46',  281.48, 3.56, 10, null],
  ['SH2-47',  281.84, 4.12, 15, null],
  ['SH2-48',  282.42, 0.48, 10, null],
  ['SH2-49',  282.34, -3.34, 150, null],
  ['SH2-54',  278.96, -12.62, 60, null],
  ['SH2-55',  282.09, -12.48, 10, null],
  ['SH2-57',  282.97, -12.57, 10, null],
  ['SH2-61',  285.09, 2.51, 5, null],
  ['SH2-63',  285.23, -4.09, 20, null],
  ['SH2-68',  286.22, -2.58, 8, null],
  ['SH2-71',  286.03, 2.28, 2, null],
  ['SH2-72',  285.85, 2.08, 10, null],
  ['SH2-73',  286.86, 0.85, 1, null],
  ['SH2-80',  288.60, 11.13, 6, null],
  ['SH2-82',  289.95, 14.78, 6, null],
  ['SH2-83',  290.45, 15.08, 5, null],
  ['SH2-84',  291.25, 12.19, 8, null],
  ['SH2-86',  292.10, 12.72, 25, 'Nébuleuse NGC 6820'],
  ['SH2-88',  292.68, 19.09, 10, null],
  ['SH2-89',  292.68, 19.09, 12, null],
  ['SH2-90',  292.86, 16.68, 5, null],
  ['SH2-91',  293.84, 19.18, 3, null],
  ['SH2-96',  294.90, 14.15, 10, null],
  ['SH2-97',  295.11, 12.89, 15, null],
  ['SH2-99',  295.73, 19.60, 10, null],
  ['SH2-100', 296.27, 16.14, 6, null],
  ['SH2-101', 296.61, 20.51, 30, 'Nébuleuse de la Tulipe'],
  ['SH2-103', 295.90, 28.37, 300, 'Réseau du Cygne'],
  ['SH2-106', 305.47, 37.36, 3, 'Nébuleuse SH2-106'],
  ['SH2-108', 297.73, 21.21, 20, 'Nébuleuse du Croissant'],
  ['SH2-109', 299.22, 22.72, 10, null],
  ['SH2-111', 300.12, 25.14, 10, null],
  ['SH2-112', 301.73, 45.60, 15, null],
  ['SH2-115', 306.27, 45.28, 40, null],
  ['SH2-116', 305.84, 47.06, 3, null],
  ['SH2-119', 316.03, 57.67, 20, null],
  ['SH2-121', 317.60, 56.75, 15, null],
  ['SH2-122', 318.43, 56.72, 8, null],
  ['SH2-124', 320.02, 54.01, 10, null],
  ['SH2-125', 321.15, 56.97, 30, 'Nébuleuse du Cocon IC 5146'],
  ['SH2-126', 321.74, 60.21, 8, null],
  ['SH2-127', 321.86, 59.56, 10, null],
  ['SH2-129', 320.85, 60.33, 20, null],
  ['SH2-130', 326.93, 64.22, 5, null],
  ['SH2-131', 336.30, 61.20, 200, 'Nébuleuse IC 1396'],
  ['SH2-132', 338.33, 56.10, 60, null],
  ['SH2-134', 343.41, 64.78, 25, null],
  ['SH2-135', 344.43, 62.55, 15, null],
  ['SH2-136', 344.31, 57.74, 10, null],
  ['SH2-140', 339.21, 63.03, 10, null],
  ['SH2-142', 341.94, 58.07, 25, 'Nébuleuse de l\'Araignée'],
  ['SH2-143', 342.07, 60.88, 10, null],
  ['SH2-144', 347.73, 59.94, 8, null],
  ['SH2-147', 83.35, 28.33, 180, 'Nébuleuse Simeis 147'],
  ['SH2-149', 349.08, 60.52, 10, null],
  ['SH2-152', 350.54, 60.38, 5, null],
  ['SH2-153', 350.80, 60.45, 8, null],
  ['SH2-155', 341.56, 62.82, 60, 'Nébuleuse de la Caverne'],
  ['SH2-157', 351.39, 61.44, 60, null],
  ['SH2-158', 351.04, 61.92, 20, null],
  ['SH2-163', 356.08, 62.92, 4, null],
  ['SH2-168', 356.95, 58.88, 20, null],
  ['SH2-170', 354.56, 67.14, 15, null],
  ['SH2-171', 353.68, 66.56, 30, null],
  ['SH2-173', 4.37, 61.75, 15, null],
  ['SH2-174', 12.00, 74.25, 30, null],
  ['SH2-175', 14.78, 62.36, 6, null],
  ['SH2-176', 20.25, 62.04, 30, null],
  ['SH2-177', 18.50, 61.40, 10, null],
  ['SH2-182', 21.56, 66.31, 20, null],
  ['SH2-183', 21.07, 68.08, 10, null],
  ['SH2-184', 14.24, 56.01, 3, null],
  ['SH2-185', 14.49, 60.78, 12, 'Nébuleuse IC 59/63'],
  ['SH2-188', 22.81, 58.85, 8, null],
  ['SH2-190', 23.98, 61.87, 20, 'Nébuleuse de l\'Étoile de mer'],
  ['SH2-198', 27.61, 60.54, 90, 'Nébuleuse du Cœur IC 1805'],
  ['SH2-199', 34.36, 60.58, 150, 'Nébuleuse de l\'Âme IC 1848'],
  ['SH2-200', 30.46, 63.33, 30, null],
  ['SH2-201', 34.59, 63.88, 60, null],
  ['SH2-204', 45.21, 57.64, 5, null],
  ['SH2-205', 48.57, 57.17, 5, null],
  ['SH2-206', 48.53, 49.98, 20, null],
  ['SH2-207', 52.79, 52.59, 5, null],
  ['SH2-208', 53.04, 52.80, 8, null],
  ['SH2-209', 50.98, 58.15, 15, null],
  ['SH2-210', 53.72, 58.92, 30, null],
  ['SH2-211', 54.12, 60.11, 10, null],
  ['SH2-212', 73.86, 47.80, 10, null],
  ['SH2-219', 74.91, 47.77, 5, null],
  ['SH2-220', 76.16, 46.16, 5, null],
  ['SH2-221', 77.00, 47.40, 8, null],
  ['SH2-224', 78.57, 37.25, 5, null],
  ['SH2-228', 83.82, 32.90, 8, null],
  ['SH2-230', 87.93, 34.56, 10, null],
  ['SH2-231', 88.37, 36.48, 5, null],
  ['SH2-232', 88.53, 37.52, 5, null],
  ['SH2-233', 88.75, 37.75, 5, null],
  ['SH2-234', 90.82, 44.74, 8, null],
  ['SH2-235', 91.41, 35.85, 20, null],
  ['SH2-236', 91.02, 39.16, 5, null],
  ['SH2-237', 92.75, 29.52, 10, null],
  ['SH2-238', 93.26, 33.64, 5, null],
  ['SH2-239', 92.68, 30.78, 20, null],
  ['SH2-240', 97.05, 27.90, 180, 'Nébuleuse du Crayon'],
  ['SH2-241', 93.36, 37.55, 10, null],
  ['SH2-242', 95.45, 38.57, 10, null],
  ['SH2-243', 95.49, 38.37, 5, null],
  ['SH2-245', 100.55, 13.36, 30, null],
  ['SH2-247', 96.55, 9.93, 10, null],
  ['SH2-249', 97.11, 22.73, 10, null],
  ['SH2-252', 98.53, 24.72, 30, 'Nébuleuse du Singe'],
  ['SH2-254', 98.90, 17.74, 10, null],
  ['SH2-255', 99.07, 18.00, 5, null],
  ['SH2-256', 99.30, 17.92, 5, null],
  ['SH2-257', 99.47, 18.15, 5, null],
  ['SH2-258', 100.27, 20.60, 8, null],
  ['SH2-261', 103.52, 9.71, 30, 'Nébuleuse du Poulpe'],
  ['SH2-263', 85.71, 7.00, 30, null],
  ['SH2-264', 85.26, 1.02, 600, 'Nébuleuse de Lambda Orionis'],
  ['SH2-273', 100.00, 22.50, 20, null],
  ['SH2-274', 111.25, 0.74, 90, null],
  ['SH2-275', 98.33, 8.79, 10, null],
  ['SH2-276', 83.78, -5.42, 180, 'Grande Nébuleuse d\'Orion étendue'],
  ['SH2-277', 81.76, -5.98, 20, null],
  ['SH2-278', 80.89, 4.07, 10, null],
  ['SH2-279', 83.73, -5.42, 20, 'Nébuleuse de Running Man'],
  ['SH2-280', 86.84, 1.97, 5, null],
  ['SH2-281', 88.89, 7.40, 5, null],
  ['SH2-283', 89.75, 9.57, 5, null],
  ['SH2-284', 96.55, 21.26, 30, null],
  ['SH2-285', 101.85, 29.55, 5, null],
  ['SH2-286', 111.18, 7.18, 8, null],
  ['SH2-289', 112.09, 13.14, 5, null],
  ['SH2-290', 115.94, 19.35, 5, null],
  ['SH2-292', 111.42, 1.48, 30, null],
  ['SH2-294', 113.56, -18.50, 15, null],
  ['SH2-295', 116.07, -12.01, 8, null],
  ['SH2-296', 108.50, -12.00, 150, null],
  ['SH2-297', 116.36, -11.32, 10, null],
  ['SH2-298', 118.15, -17.33, 10, null],
  ['SH2-299', 118.71, -13.87, 10, null],
  ['SH2-300', 123.16, -32.71, 15, null],
  ['SH2-301', 121.75, -20.68, 10, null],
  ['SH2-302', 122.87, -23.35, 20, null],
  ['SH2-303', 122.69, -24.68, 8, null],
  ['SH2-304', 124.21, -27.54, 10, null],
  ['SH2-305', 126.65, -34.58, 12, null],
  ['SH2-306', 129.12, -34.67, 8, null],
  ['SH2-307', 139.34, -34.87, 8, null],
  ['SH2-308', 98.49, -14.37, 40, 'Nébuleuse de l\'Étoile de Mer Zeta Puppis'],
  ['SH2-311', 123.96, -26.68, 90, 'Nébuleuse NGC 2467'],
  ['SH2-312', 131.72, -32.38, 30, null],
];

// ─── OpenNGC type mapping ────────────────────────────────────────────────────
const TYPE_MAP = {
  'G':    'Gx',  'Gxy':  'Gx', 'GxyP': 'Gx',
  'GGroup': 'Gx', 'GPair': 'Gx', 'GTrpl': 'Gx',
  'OCl':  'OC',  'OClAs': 'OC',
  'GCl':  'GC',
  'EN':   'EN',  'EmN':  'EN', 'EnN':  'EN',
  'RN':   'RN',  'RefN': 'RN',
  'PN':   'PN',
  'SNR':  'SNR',
  'DN':   'DN',  'DrkN': 'DN',
  'C+N':  'EN',  'Cl+N': 'EN',
  'Neb':  '?',   'Nov':  '?', 'Other': '?',
  '*':    null,   '**':   null, // Skip single/double stars
  'Dup':  null,   'PD':   null,
};

function parseRA(raStr) {
  if (!raStr) return null;
  const parts = raStr.trim().split(':');
  if (parts.length < 2) return null;
  const h = parseFloat(parts[0]);
  const m = parseFloat(parts[1]);
  const s = parts.length >= 3 ? parseFloat(parts[2]) : 0;
  return (h + m / 60 + s / 3600) * 15;
}

function parseDec(decStr) {
  if (!decStr) return null;
  const sign = decStr.startsWith('-') ? -1 : 1;
  const abs = decStr.replace(/^[+-]/, '');
  const parts = abs.split(':');
  const d = parseFloat(parts[0]);
  const m = parts.length >= 2 ? parseFloat(parts[1]) : 0;
  const s = parts.length >= 3 ? parseFloat(parts[2]) : 0;
  return sign * (d + m / 60 + s / 3600);
}

function parseNum(s) {
  if (!s || s.trim() === '') return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

async function fetchNGC() {
  const url = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv';
  console.log('Downloading OpenNGC CSV...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = lines[0].split(';').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(';');
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cols[j] ? cols[j].trim() : '';
    }
    rows.push(row);
  }
  return rows;
}

async function main() {
  const csvText = await fetchNGC();
  const rows = parseCSV(csvText);
  console.log(`Parsed ${rows.length} rows from OpenNGC`);

  const data = [];
  let skipped = 0;

  for (const row of rows) {
    // Determine primary id
    const catalog = row['Catalog'] || row['Name'] || '';
    const objName = row['Name'] || row['Object'] || '';

    // Parse type
    const rawType = row['Type'] || row['ObjectType'] || '';
    const mappedType = TYPE_MAP[rawType];
    if (mappedType === null || mappedType === undefined) {
      // Skip stars and unknown types (null means skip, undefined means unknown)
      if (mappedType === null) { skipped++; continue; }
    }
    const dsoType = mappedType || '?';

    // Parse coordinates
    const ra = parseRA(row['RA'] || row['Ra']);
    const dec = parseDec(row['Dec'] || row['DEC']);
    if (ra === null || dec === null) { skipped++; continue; }

    // Filter: dec > -35
    if (dec < -35) { skipped++; continue; }

    // Build ID
    let id = '';
    const catName = objName || catalog;
    if (catName.startsWith('NGC') || catName.startsWith('IC')) {
      // Strip zero-padding: NGC0869 → NGC869, IC0010 → IC10
      const prefix = catName.startsWith('NGC') ? 'NGC' : 'IC';
      const num = parseInt(catName.slice(prefix.length), 10);
      id = `${prefix}${num}`;
    } else {
      skipped++; continue;
    }

    // Messier designation
    const messierNum = row['M'] || row['Messier'];
    let primaryId = id;
    if (messierNum && messierNum.trim() !== '') {
      primaryId = `M${parseInt(messierNum.trim(), 10)}`;
    }

    // Dimensions
    const majAxis = parseNum(row['MajAx'] || row['Maj.Ax.'] || row['SizeMax']);
    const minAxis = parseNum(row['MinAx'] || row['Min.Ax.'] || row['SizeMin']);
    const pa = parseNum(row['PA'] || row['PosAng']) || 0;
    const mag = parseNum(row['V-Mag'] || row['Mag'] || row['Bmag'] || row['Vmag']);

    // French name
    const nameFr = FRENCH_NAMES[primaryId] || FRENCH_NAMES[id] || null;
    // English name
    const nameEn = ENGLISH_NAMES[primaryId] || ENGLISH_NAMES[id] || null;

    // Convert arcminutes → arcminutes (majAxis is already in arcmin in OpenNGC)
    data.push([
      primaryId,
      Math.round(ra * 1000) / 1000,
      Math.round(dec * 1000) / 1000,
      dsoType,
      majAxis !== null ? Math.round(majAxis * 10) / 10 : null,
      minAxis !== null ? Math.round(minAxis * 10) / 10 : null,
      Math.round(pa),
      mag !== null ? Math.round(mag * 100) / 100 : null,
      nameFr,
      nameEn,
    ]);
  }

  // Add SH2 objects
  for (const [id, ra, dec, majAxis, nameFr] of SH2_DATA) {
    if (dec < -35) continue;
    const nameEn = SH2_ENGLISH_NAMES[id] || null;
    data.push([
      id,
      Math.round(ra * 1000) / 1000,
      Math.round(dec * 1000) / 1000,
      'EN',
      majAxis,
      null,
      0,
      null,
      nameFr,
      nameEn,
    ]);
  }

  // Sort by magnitude (brightest first, nulls last)
  data.sort((a, b) => {
    const ma = a[7];
    const mb = b[7];
    if (ma === null && mb === null) return 0;
    if (ma === null) return 1;
    if (mb === null) return -1;
    return ma - mb;
  });

  console.log(`Generated ${data.length} DSOs (skipped ${skipped})`);

  const output = {
    fields: ['id', 'ra', 'dec', 'type', 'majAxis', 'minAxis', 'pa', 'mag', 'nameFr', 'nameEn'],
    data,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output));
  console.log(`Written to ${OUT_PATH} (${(JSON.stringify(output).length / 1024).toFixed(1)} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
