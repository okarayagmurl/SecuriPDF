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
echo "[3/4] Dogrulama..."
if [[ -f "${ROOT_DIR}/MANIFEST.json" ]] && docker ps --format '{{.Names}}' | grep -q '^securipdf-platform$'; then
  docker exec securipdf-platform mkdir -p /vault-data/upgrades/staging
  docker cp "${ROOT_DIR}/MANIFEST.json" securipdf-platform:/vault-data/upgrades/staging/manifest.json
  echo "Staging MANIFEST platform vault'a yazildi (Admin > Operasyon)."
fi
bash "${DOCKER_DIR}/verify-auth-urls.sh"
if [[ -x "${DOCKER_DIR}/test-stack.sh" ]]; then
  bash "${DOCKER_DIR}/test-stack.sh"
fi

echo ""
echo "[4/4] Platform surum API dogrulamasi..."
if docker ps --format '{{.Names}}' | grep -q '^securipdf-platform$'; then
  if docker exec securipdf-platform curl -sf --max-time 10 http://127.0.0.1:8000/openapi.json \
    | grep -q '"/api/vault/v1/admin/ops/version"'; then
    echo "  OK: /admin/ops/version endpoint mevcut"
  else
    echo "UYARI: Platform image eski — Admin > Operasyon surum API 404 verebilir." >&2
    echo "  cd ~/SecuriPDF && git pull && sudo bash scripts/patch-logout-deploy.sh" >&2
  fi
else
  echo "  UYARI: securipdf-platform calismiyor"
fi

HTTP_PORT="${HTTP_PORT:-8080}"
echo ""
echo "=== Guncelleme tamam ==="
echo "  Uygulama: http://${HOST}:${HTTP_PORT}"
echo "  Tarayici: Ctrl+Shift+R ile onbellegi temizleyip cikis testi yapin"

UPDATER_INSTALL="${ROOT_DIR}/scripts/securipdf-updater/install-updater.sh"
if [[ -f "${UPDATER_INSTALL}" && -z "${SECURIPDF_UPDATER_SKIP_INSTALL:-}" ]]; then
  echo ""
  echo "[+] Host updater agent (securipdf-updater)..."
  SECURIPDF_OFFLINE_DIR="${ROOT_DIR}" bash "${UPDATER_INSTALL}" || {
    echo "UYARI: updater kurulumu tamamlanamadi — elle calistirin:" >&2
    echo "  sudo SECURIPDF_OFFLINE_DIR=${ROOT_DIR} bash ${UPDATER_INSTALL}" >&2
  }
fi
