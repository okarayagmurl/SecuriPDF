#!/usr/bin/env bash
# SecuriPDF — Offline kurulum paketi olusturur (internet OLAN build makinesinde calistirin)
#
# Kullanim:
#   cd SecuriPDF
#   ./scripts/build-offline-bundle.sh
#   ./scripts/build-offline-bundle.sh --output /tmp/releases
#
# Cikti:
#   dist/securipdf-<VERSION>-offline.tar.gz
#   dist/securipdf-<VERSION>-offline/
#     images/securipdf-images.tar
#     MANIFEST.json
#     CHECKSUMS.sha256
#     ... (compose, config, scripts, docker/)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"
OUTPUT_ROOT="${ROOT_DIR}/dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT_ROOT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "Bilinmeyen arguman: $1" >&2; exit 1 ;;
  esac
done

if [[ -f "${DOCKER_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  source "${DOCKER_DIR}/load-env.sh"
  load_dotenv "${DOCKER_DIR}/.env"
fi

VERSION_FILE_TAG=""
if [[ -f "${ROOT_DIR}/VERSION" ]]; then
  VERSION_FILE_TAG="$(tr -d '[:space:]' < "${ROOT_DIR}/VERSION")"
fi
# Offline paket surumu: VERSION dosyasi oncelikli (.env IMAGE_TAG gelistirme etiketini ezmesin)
if [[ -n "${VERSION_FILE_TAG}" ]]; then
  IMAGE_TAG="${VERSION_FILE_TAG}"
else
  IMAGE_TAG="${IMAGE_TAG:-1.2.1-stirling-2.14.3}"
fi
STIRLING_VERSION="${STIRLING_VERSION:-$(echo "${IMAGE_TAG}" | sed -n 's/.*-stirling-//p')}"
STIRLING_VERSION="${STIRLING_VERSION:-2.14.3}"
STIRLING_IMAGE="${STIRLING_IMAGE:-docker.stirlingpdf.com/stirlingtools/stirling-pdf}"
# Web/CLI yükseltme uyumu: bir önceki ana sürüm (override: PREV_VERSION=...)
# Bos string .env'den gelirse default'a dus
if [[ -z "${PREV_VERSION:-}" ]]; then
  PREV_VERSION="1.2.0-stirling-2.14.3"
fi
if [[ "${PREV_VERSION}" == "${IMAGE_TAG}" ]]; then
  PREV_VERSION=""
fi
VERSION_DIR="securipdf-${IMAGE_TAG}-offline"
STAGING="${OUTPUT_ROOT}/${VERSION_DIR}"
IMAGES_TAR="${STAGING}/images/securipdf-images.tar"

COMPOSE_BUILD=(
  -f docker-compose.yml
  -f docker-compose.auth.yml
)
COMPOSE_OFFLINE=(
  -f docker-compose.yml
  -f docker-compose.auth.yml
  -f docker-compose.offline.yml
)

echo "=== SecuriPDF offline paket build ==="
echo "Surum: ${IMAGE_TAG}"
echo "Staging: ${STAGING}"

if ! command -v docker &>/dev/null; then
  DEBS_DIR="${ROOT_DIR}/offline/debs"
  if [[ -d "${DEBS_DIR}" ]] && compgen -G "${DEBS_DIR}/*.deb" >/dev/null; then
    echo ""
    echo "Docker kurulu degil — offline/debs ile kuruluyor..."
    INSTALL_SCRIPT="${ROOT_DIR}/scripts/ubuntu/install-prerequisites-offline.sh"
    if [[ "${EUID}" -ne 0 ]]; then
      sudo bash "${INSTALL_SCRIPT}"
    else
      bash "${INSTALL_SCRIPT}"
    fi
  else
    echo "HATA: docker bulunamadi ve offline/debs bos." >&2
    echo "  1) sudo bash scripts/ubuntu/download-offline-debs.sh" >&2
    echo "  2) sudo bash scripts/ubuntu/install-prerequisites-offline.sh" >&2
    echo "  3) ./scripts/build-offline-bundle.sh" >&2
    exit 1
  fi
fi

if ! docker info &>/dev/null; then
  echo "HATA: Docker daemon calismiyor. sudo systemctl start docker" >&2
  exit 1
fi

mkdir -p "${STAGING}/images"

cd "${DOCKER_DIR}"

export SECURIPDF_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export IMAGE_TAG STIRLING_VERSION

PLATFORM_UI_VER="$(grep -oE 'app\.js\?v=[0-9]+' "${ROOT_DIR}/services/platform/app/static/app/index.html" | grep -oE '[0-9]+' || echo 0)"
CHANGELOG_TEXT=""
if [[ -f "${ROOT_DIR}/CHANGELOG.md" ]]; then
  CHANGELOG_TEXT="$(awk -v ver="${IMAGE_TAG}" '
    $0 ~ "^## "ver {show=1; next}
    show && /^## / {exit}
    show {gsub(/"/, "\\\""); printf "%s ", $0}
  ' "${ROOT_DIR}/CHANGELOG.md" | sed 's/[[:space:]]*$//')"
fi
[[ -n "${CHANGELOG_TEXT}" ]] || CHANGELOG_TEXT="SecuriPDF ${IMAGE_TAG} offline paketi"

echo ""
echo "[1/5] SecuriPDF image'lari derleniyor..."
docker compose "${COMPOSE_BUILD[@]}" build entera-pdf securipdf-platform

echo ""
echo "[2/5] Upstream image'lar cekiliyor..."
docker pull "nginx:1.27-alpine"
docker pull "postgres:16-alpine"
docker pull "quay.io/keycloak/keycloak:26.0"
docker pull "quay.io/oauth2-proxy/oauth2-proxy:v7.8.2"
docker pull "${STIRLING_IMAGE}:${STIRLING_VERSION}-fat" || true

IMAGE_REFS=(
  "entera-pdf:${IMAGE_TAG}"
  "securipdf-platform:${IMAGE_TAG}"
  "nginx:1.27-alpine"
  "postgres:16-alpine"
  "quay.io/keycloak/keycloak:26.0"
  "quay.io/oauth2-proxy/oauth2-proxy:v7.8.2"
)

echo ""
echo "[3/5] Image arsivi olusturuluyor..."
docker save -o "${IMAGES_TAR}" "${IMAGE_REFS[@]}"
echo "  -> ${IMAGES_TAR} ($(du -h "${IMAGES_TAR}" | cut -f1))"

echo ""
echo "[4/5] Dosyalar kopyalaniyor..."

copy_tree() {
  local src="$1"
  local dst="$2"
  mkdir -p "${dst}"
  if command -v rsync &>/dev/null; then
    rsync -a --exclude '__pycache__' --exclude '.git' "${src}/" "${dst}/"
  else
    cp -a "${src}/." "${dst}/"
  fi
}

copy_tree "${DOCKER_DIR}" "${STAGING}/docker"
copy_tree "${ROOT_DIR}/config" "${STAGING}/config"
copy_tree "${ROOT_DIR}/branding" "${STAGING}/branding"
copy_tree "${ROOT_DIR}/scripts" "${STAGING}/scripts"
if [[ -d "${ROOT_DIR}/offline" ]]; then
  copy_tree "${ROOT_DIR}/offline" "${STAGING}/offline"
fi
mkdir -p "${STAGING}/docs"
cp "${ROOT_DIR}/docs/INSTALL-UBUNTU.md" "${STAGING}/docs/" 2>/dev/null || true
cp "${ROOT_DIR}/docs/OFFLINE-INSTALL.md" "${STAGING}/docs/" 2>/dev/null || true
cp "${ROOT_DIR}/docs/FRESH-INSTALL-RUNBOOK.md" "${STAGING}/docs/" 2>/dev/null || true
cp "${ROOT_DIR}/docs/AD-KEYCLOAK-SETUP.md" "${STAGING}/docs/" 2>/dev/null || true
cp "${ROOT_DIR}/docs/TROUBLESHOOTING.md" "${STAGING}/docs/" 2>/dev/null || true

cp "${DOCKER_DIR}/.env.offline.example" "${STAGING}/docker/.env.example"
cp "${ROOT_DIR}/scripts/install-offline.sh" "${STAGING}/install-offline.sh"
copy_tree "${ROOT_DIR}/installer" "${STAGING}/installer"
chmod +x "${STAGING}/install-offline.sh" 2>/dev/null || true
chmod +x "${STAGING}/installer/install.sh" "${STAGING}/installer/lib/"*.sh 2>/dev/null || true
chmod +x "${STAGING}/scripts/ubuntu/"*.sh 2>/dev/null || true
chmod +x "${STAGING}/docker/fix-access-url.sh" "${STAGING}/docker/"*.sh 2>/dev/null || true
chmod +x "${STAGING}/scripts/upgrade-offline-stack.sh" 2>/dev/null || true
chmod +x "${STAGING}/scripts/securipdf-updater/updater.py" 2>/dev/null || true
chmod +x "${STAGING}/scripts/securipdf-updater/install-updater.sh" 2>/dev/null || true

DEB_COUNT=0
PWSH_COUNT=0
[[ -d "${ROOT_DIR}/offline/debs" ]] && DEB_COUNT=$(find "${ROOT_DIR}/offline/debs" -name '*.deb' 2>/dev/null | wc -l)
[[ -d "${ROOT_DIR}/offline/debs-pwsh" ]] && PWSH_COUNT=$(find "${ROOT_DIR}/offline/debs-pwsh" -name '*.deb' 2>/dev/null | wc -l)
if [[ "${DEB_COUNT}" -eq 0 ]]; then
  echo "UYARI: offline/debs bos — musteri Docker onceden kurulu olmali veya download-offline-debs.sh calistirin."
fi
if [[ "${PWSH_COUNT}" -eq 0 ]]; then
  echo "UYARI: offline/debs-pwsh bos — musteride Keycloak bootstrap icin pwsh gerekir."
fi

if [[ -n "${PREV_VERSION}" ]]; then
  UPGRADE_FROM_JSON="[\"${PREV_VERSION}\"]"
  MIN_UPGRADE_FROM="${PREV_VERSION}"
else
  UPGRADE_FROM_JSON="[]"
  MIN_UPGRADE_FROM=""
fi

cat > "${STAGING}/MANIFEST.json" <<EOF
{
  "product": "SecuriPDF",
  "package_kind": "full",
  "version": "${IMAGE_TAG}",
  "stirling_version": "${STIRLING_VERSION}",
  "built_at": "${SECURIPDF_BUILT_AT}",
  "min_upgrade_from": "${MIN_UPGRADE_FROM}",
  "upgrade_from": ${UPGRADE_FROM_JSON},
  "platform_ui": ${PLATFORM_UI_VER},
  "oauth2_proxy": "v7.8.2",
  "keycloak": "26.0",
  "changelog": "${CHANGELOG_TEXT}",
  "images_archive": "images/securipdf-images.tar",
  "images": [
    "entera-pdf:${IMAGE_TAG}",
    "securipdf-platform:${IMAGE_TAG}",
    "nginx:1.27-alpine",
    "postgres:16-alpine",
    "quay.io/keycloak/keycloak:26.0",
    "quay.io/oauth2-proxy/oauth2-proxy:v7.8.2"
  ],
  "compose": [
    "docker/docker-compose.yml",
    "docker/docker-compose.auth.yml",
    "docker/docker-compose.offline.yml"
  ],
  "install": "cd installer && ./install.sh",
  "install_offline_cli": "./install-offline.sh --load-images --deploy --verify",
  "upgrade_cli": "sudo bash scripts/upgrade-offline-stack.sh",
  "delta_build": "./scripts/build-offline-delta.sh --from <ONCEKI_SURUM>",
  "updater_install": "sudo SECURIPDF_OFFLINE_DIR=. bash scripts/securipdf-updater/install-updater.sh",
  "diag_url": "http://<host>:8765/diag",
  "offline_debs": "offline/debs",
  "offline_pwsh_debs": "offline/debs-pwsh"
}
EOF

echo ""
echo "[5/5] Arsiv ve checksum..."
cd "${OUTPUT_ROOT}"
(
  cd "${VERSION_DIR}"
  if command -v sha256sum &>/dev/null; then
    find . -type f ! -name 'CHECKSUMS.sha256' -print0 | sort -z | xargs -0 sha256sum > CHECKSUMS.sha256
  fi
)
tar -czf "${VERSION_DIR}.tar.gz" "${VERSION_DIR}"
if command -v sha256sum &>/dev/null; then
  sha256sum "${VERSION_DIR}.tar.gz" > "${VERSION_DIR}.tar.gz.sha256"
fi

echo ""
echo "=== Tamam (full) ==="
echo "Paket: ${OUTPUT_ROOT}/${VERSION_DIR}.tar.gz"
echo "Boyut: $(du -h "${OUTPUT_ROOT}/${VERSION_DIR}.tar.gz" | cut -f1)"
echo ""
echo "Musteri sunucusunda (yeni kurulum):"
echo "  tar xzf ${VERSION_DIR}.tar.gz"
echo "  cd ${VERSION_DIR}"
echo "  sudo bash scripts/ubuntu/install-prerequisites-offline.sh"
echo "  cd installer && ./install.sh"
echo ""
echo "Mevcut kurulumu guncelleme (full paket):"
echo "  tar xzf ${VERSION_DIR}.tar.gz && cd ${VERSION_DIR}"
echo "  sudo bash scripts/upgrade-offline-stack.sh"

# Path/delta her full build sonunda (PREV_VERSION varsa)
SKIP_DELTA="${SKIP_DELTA:-0}"
if [[ "${SKIP_DELTA}" != "1" && -n "${PREV_VERSION}" && "${PREV_VERSION}" != "${IMAGE_TAG}" ]]; then
  echo ""
  echo "=== Delta paket (otomatik) ==="
  echo "From: ${PREV_VERSION} -> To: ${IMAGE_TAG}"
  chmod +x "${SCRIPT_DIR}/build-offline-delta.sh" 2>/dev/null || true
  bash "${SCRIPT_DIR}/build-offline-delta.sh" \
    --from "${PREV_VERSION}" \
    --to "${IMAGE_TAG}" \
    --output "${OUTPUT_ROOT}"
else
  echo ""
  echo "Delta atlandi (SKIP_DELTA=${SKIP_DELTA} PREV_VERSION='${PREV_VERSION}')."
fi
