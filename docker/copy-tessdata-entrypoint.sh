#!/bin/sh
# Volume, imajdaki tessdata yolunu gizler. Eksik dil paketlerini acilista kopyala.
set -eu
DEST="/usr/share/tesseract-ocr/5/tessdata"
SRC="/opt/securipdf-tessdata"
mkdir -p "$DEST"
if [ -d "$SRC" ]; then
  for f in "$SRC"/*.traineddata; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    if [ ! -s "$DEST/$base" ]; then
      cp "$f" "$DEST/$base"
    fi
  done
fi
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
TINI="$(command -v tini || true)"
if [ -n "$TINI" ] && [ -x /scripts/init.sh ]; then
  exec "$TINI" -- /scripts/init.sh
fi
if [ -x /init ]; then
  exec /init
fi
echo "SecuriPDF: Stirling giris komutu bulunamadi" >&2
exit 1
