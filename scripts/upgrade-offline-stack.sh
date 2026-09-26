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
IMAGES_DELTA_TAR="${ROOT_DIR}/images/securipdf-images-delta.tar"
PACKAGE_KIND="full"
FROM_VERSION=""
NEW_TAG=""
NEW_STIRLING=""

if [[ -f "${ROOT_DIR}/MANIFEST.json" ]]; then
  PACKAGE_KIND="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("package_kind") or "full")' "${ROOT_DIR}/MANIFEST.json" 2>/dev/null || echo full)"
  FROM_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("from_version") or "")' "${ROOT_DIR}/MANIFEST.json" 2>/dev/null || true)"
  NEW_TAG="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version",""))' "${ROOT_DIR}/MANIFEST.json" 2>/dev/null || true)"
  NEW_STIRLING="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("stirling_version",""))' "${ROOT_DIR}/MANIFEST.json" 2>/dev/null || true)"
fi

if [[ "${PACKAGE_KIND}" == "delta" ]]; then
  IMAGES_TAR="${IMAGES_DELTA_TAR}"
fi

echo "=== SecuriPDF offline stack guncelleme ==="
echo "Paket: ${ROOT_DIR}"
echo "Tur: ${PACKAGE_KIND}"

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

# Delta: kurulu IMAGE_TAG from_version ile eslesmeli
if [[ "${PACKAGE_KIND}" == "delta" ]]; then
  CUR_TAG="${IMAGE_TAG:-}"
  if [[ -z "${FROM_VERSION}" ]]; then
    echo "HATA: delta MANIFEST.from_version bos" >&2
    exit 1
  fi
  if [[ "${CUR_TAG}" != "${FROM_VERSION}" ]]; then
    echo "HATA: delta paket ${FROM_VERSION} -> ${NEW_TAG} icin; kurulu IMAGE_TAG=${CUR_TAG}" >&2
    echo "  Full offline paket kullanin veya dogru path delta secin." >&2
    exit 1
  fi
  echo "[+] Delta dogrulandi: ${FROM_VERSION} -> ${NEW_TAG}"
fi

HOST="${PUBLIC_FQDN:-${KEYCLOAK_HOSTNAME:-}}"
[[ -n "${HOST}" && "${HOST}" != "localhost" ]] || {
  echo "HATA: PUBLIC_FQDN/KEYCLOAK_HOSTNAME gecerli degil (.env). Ornek: 192.168.6.175" >&2
  exit 1
}

echo ""
echo "[1/4] Image'lar yukleniyor (${PACKAGE_KIND})..."
docker load -i "${IMAGES_TAR}"

# MANIFEST.version -> .env IMAGE_TAG
if [[ -n "${NEW_TAG}" ]]; then
  set_env_key() {
    local key="$1" val="$2" tmp="${ENV_FILE}.tmp.$$"
    if grep -q "^${key}=" "${ENV_FILE}"; then
      grep -v "^${key}=" "${ENV_FILE}" > "${tmp}"
      printf '%s=%s\n' "${key}" "${val}" >> "${tmp}"
      mv "${tmp}" "${ENV_FILE}"
    else
      printf '%s=%s\n' "${key}" "${val}" >> "${ENV_FILE}"
    fi
  }
  echo "[+] IMAGE_TAG -> ${NEW_TAG}"
  set_env_key IMAGE_TAG "${NEW_TAG}"
  if [[ -n "${NEW_STIRLING}" ]]; then
    set_env_key STIRLING_VERSION "${NEW_STIRLING}"
  fi
  # shellcheck disable=SC1091
  load_dotenv "${ENV_FILE}"
fi

echo ""
echo "[2/4] Erisim URL + auth stack senkronu (${HOST})..."
bash "${DOCKER_DIR}/fix-access-url.sh" "${HOST}"

# Yeni image tag ile servisleri yenile (fix-access-url zaten up yapar; tag degistiyse zorla recreate)
if [[ -n "${NEW_TAG}" ]]; then
  echo "[+] Container'lar yeni tag ile yenileniyor (${NEW_TAG})..."
  (
    cd "${DOCKER_DIR}"
    COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth.yml)
    [[ -f docker-compose.offline.yml ]] && COMPOSE+=(-f docker-compose.offline.yml)
    "${COMPOSE[@]}" up -d --no-build --force-recreate entera-pdf securipdf-platform
  )
fi

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
