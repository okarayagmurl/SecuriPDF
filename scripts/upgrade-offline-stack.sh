#!/usr/bin/env bash
# Mevcut offline kurulumu yeni image/script paketi ile gunceller (elle dosya kopyalamadan).
#
# Kullanim (yeni offline paket acildiktan sonra):
#   cd securipdf-*-offline
#   sudo ./scripts/upgrade-offline-stack.sh
#
# Yapar: image load, URL senkronu, Keycloak bootstrap, logout URI, dogrulama
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"
ENV_FILE="${DOCKER_DIR}/.env"
IMAGES_TAR="${ROOT_DIR}/images/securipdf-images.tar"

echo "=== SecuriPDF offline stack guncelleme ==="
echo "Paket: ${ROOT_DIR}"

command -v docker &>/dev/null || { echo "HATA: docker yok" >&2; exit 1; }
docker info &>/dev/null || { echo "HATA: docker yetkisi yok (sudo veya docker grubu)" >&2; exit 1; }

if [[ ! -f "${IMAGES_TAR}" ]]; then
  echo "HATA: ${IMAGES_TAR} bulunamadi" >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "HATA: ${ENV_FILE} bulunamadi — mevcut kurulum dizininde calistirin." >&2
  echo "  Yeni paketi ayni dizine acin (docker/.env korunur):" >&2
  echo "    cd ~/securipdf-*-offline" >&2
  echo "    tar xzf ../securipdf-*-offline.tar.gz --strip-components=1" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "${DOCKER_DIR}/load-env.sh"
load_dotenv "${ENV_FILE}"

HOST="${PUBLIC_FQDN:-${KEYCLOAK_HOSTNAME:-}}"
[[ -n "${HOST}" && "${HOST}" != "localhost" ]] || {
  echo "HATA: PUBLIC_FQDN/KEYCLOAK_HOSTNAME gecerli degil (.env). Ornek: 192.168.6.175" >&2
  exit 1
}

echo ""
echo "[1/3] Image'lar yukleniyor..."
docker load -i "${IMAGES_TAR}"

echo ""
echo "[2/3] Erisim URL + auth stack senkronu (${HOST})..."
bash "${DOCKER_DIR}/fix-access-url.sh" "${HOST}"

echo ""
echo "[3/3] Dogrulama..."
if [[ -f "${ROOT_DIR}/MANIFEST.json" ]] && docker ps --format '{{.Names}}' | grep -q '^securipdf-platform$'; then
  docker exec securipdf-platform mkdir -p /vault-data/upgrades/staging
  docker cp "${ROOT_DIR}/MANIFEST.json" securipdf-platform:/vault-data/upgrades/staging/manifest.json
  echo "Staging MANIFEST platform vault'a yazildi (Admin > Operasyon)."
fi
bash "${DOCKER_DIR}/verify-auth-urls.sh"
if [[ -x "${DOCKER_DIR}/test-stack.sh" ]]; then
  bash "${DOCKER_DIR}/test-stack.sh"
fi

HTTP_PORT="${HTTP_PORT:-8080}"
echo ""
echo "=== Guncelleme tamam ==="
echo "  Uygulama: http://${HOST}:${HTTP_PORT}"
echo "  Tarayici: Ctrl+Shift+R ile onbellegi temizleyip cikis testi yapin"
