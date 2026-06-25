#!/usr/bin/env bash
# OCR dil paketlerini entera_data volume'una indirir (tur.traineddata vb.)
set -euo pipefail

COMPOSE_PROJECT="${COMPOSE_PROJECT:-entera-pdf}"
VOLUME="${TESSDATA_VOLUME:-${COMPOSE_PROJECT}_entera_data}"
TESSDATA_BASE="${TESSDATA_MIRROR:-https://github.com/tesseract-ocr/tessdata/raw/main}"

LANGS="${*:-tur}"

if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  echo "Volume bulunamadi: $VOLUME" >&2
  echo "Once stack'i bir kez baslatin: cd docker && docker compose up -d entera-pdf" >&2
  exit 1
fi

for lang in $LANGS; do
  file="${lang}.traineddata"
  dest="/usr/share/tesseract-ocr/5/tessdata/${file}"
  if docker ps --format '{{.Names}}' | grep -qx entera-pdf; then
    echo "Indiriliyor (entera-pdf): $file"
    docker exec entera-pdf curl -fsSL "${TESSDATA_BASE}/${file}" -o "$dest"
    docker exec entera-pdf ls -lh "$dest"
  else
    url="${TESSDATA_BASE}/${file}"
    echo "Indiriliyor (volume): $file"
    docker run --rm \
      -v "${VOLUME}:/tessdata" \
      curlimages/curl:8.12.1 \
      -fsSL "$url" -o "/tessdata/${file}"
    docker run --rm -v "${VOLUME}:/tessdata" alpine ls -lh "/tessdata/${file}"
  fi
done

echo "Tamam. Stirling'i yeniden baslatin: docker compose restart entera-pdf"
