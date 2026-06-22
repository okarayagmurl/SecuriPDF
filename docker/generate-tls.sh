#!/usr/bin/env bash
# SecuriPDF — self-signed TLS (dev / intranet)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSL_DIR="${SCRIPT_DIR}/nginx/ssl"
mkdir -p "${SSL_DIR}"

KEY="${SSL_DIR}/securipdf.key"
CRT="${SSL_DIR}/securipdf.crt"

if [[ -f "${CRT}" ]]; then
  echo "TLS sertifikasi zaten var: ${CRT}"
  exit 0
fi

echo "Self-signed TLS olusturuluyor..."
docker run --rm -v "${SSL_DIR}:/ssl" alpine/openssl req -x509 -nodes -days 825 \
  -newkey rsa:2048 \
  -keyout /ssl/securipdf.key \
  -out /ssl/securipdf.crt \
  -subj "/CN=securipdf.local/O=Entera"

echo "Tamam: ${CRT}"
