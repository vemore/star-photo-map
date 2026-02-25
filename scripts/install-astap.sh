#!/bin/bash
set -e

ASTAP_DIR=/opt/astap
mkdir -p "$ASTAP_DIR"

# Binaire Linux 64-bit — version ligne de commande (~315 KB, sans GUI)
echo "Téléchargement du binaire ASTAP CLI…"
wget -q --show-progress -L \
  -O /tmp/astap_cli.zip \
  "https://sourceforge.net/projects/astap-program/files/linux_installer/astap_command-line_version_Linux_amd64.zip/download"
unzip -o /tmp/astap_cli.zip -d "$ASTAP_DIR"
chmod +x "$ASTAP_DIR"/astap_cli
rm /tmp/astap_cli.zip

# Catalogue D20 (~400 MB, ~2000 étoiles/deg², bon compromis taille/profondeur)
# Alternatives : d05_star_database.zip (~102 MB) ou d50_star_database.zip (~900 MB)
echo "Téléchargement du catalogue D20…"
wget -q --show-progress -L \
  -O /tmp/d20.zip \
  "https://sourceforge.net/projects/astap-program/files/star_databases/d20_star_database.zip/download"
unzip -o /tmp/d20.zip -d "$ASTAP_DIR"
rm /tmp/d20.zip

echo ""
echo "Installation terminée dans $ASTAP_DIR"
echo "Ajouter dans l'environnement : ASTAP_PATH=$ASTAP_DIR/astap_cli"
