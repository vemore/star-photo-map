#!/bin/bash
# Télécharge le catalogue profond d3-celestial (Hipparcos complet, ~118k étoiles)
mkdir -p server/data
curl -L -o server/data/stars.deep.json \
  "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.14.json"
echo "Catalogue téléchargé dans server/data/stars.deep.json"
