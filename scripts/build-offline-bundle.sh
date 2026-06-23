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
  set -a
  # shellcheck disable=SC1091
  source "${DOCKER_DIR}/.env"
  set +a
fi

IMAGE_TAG="${IMAGE_TAG:-1.0.0-stirling-0.46.2}"
STIRLING_VERSION="${STIRLING_VERSION:-0.46.2}"
STIRLING_IMAGE="${STIRLING_IMAGE:-docker.stirlingpdf.com/stirlingtools/stirling-pdf}"
VERSION_DIR="securipdf-${IMAGE_TAG}-offline"
STAGING="${OUTPUT_ROOT}/${VERSION_DIR}"
IMAGES_TAR="${STAGING}/images/securipdf-images.tar"

COMPOSE_FILES=(
  -f docker-compose.yml
  -f docker-compose.auth.yml
  -f docker-compose.offline.yml
)

echo "=== SecuriPDF offline paket build ==="
echo "Surum: ${IMAGE_TAG}"
echo "Staging: ${STAGING}"

mkdir -p "${STAGING}/images"

cd "${DOCKER_DIR}"

echo ""
echo "[1/5] SecuriPDF image'lari derleniyor..."
docker compose "${COMPOSE_FILES[@]}" build entera-pdf securipdf-platform

echo ""
echo "[2/5] Upstream image'lar cekiliyor..."
docker pull "nginx:1.27-alpine"
docker pull "postgres:16-alpine"
docker pull "quay.io/keycloak/keycloak:26.0"
docker pull "quay.io/oauth2-proxy/oauth2-proxy:v7.7.1"
docker pull "${STIRLING_IMAGE}:${STIRLING_VERSION}-fat" || true

IMAGE_REFS=(
  "entera-pdf:${IMAGE_TAG}"
  "securipdf-platform:${IMAGE_TAG}"
  "nginx:1.27-alpine"
  "postgres:16-alpine"
  "quay.io/keycloak/keycloak:26.0"
  "quay.io/oauth2-proxy/oauth2-proxy:v7.7.1"
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
cp "${ROOT_DIR}/docs/AD-KEYCLOAK-SETUP.md" "${STAGING}/docs/" 2>/dev/null || true
cp "${ROOT_DIR}/docs/TROUBLESHOOTING.md" "${STAGING}/docs/" 2>/dev/null || true

cp "${DOCKER_DIR}/.env.offline.example" "${STAGING}/docker/.env.example"
cp "${ROOT_DIR}/scripts/install-offline.sh" "${STAGING}/install-offline.sh"
copy_tree "${ROOT_DIR}/installer" "${STAGING}/installer"
chmod +x "${STAGING}/install-offline.sh" 2>/dev/null || true
chmod +x "${STAGING}/installer/install.sh" "${STAGING}/installer/lib/"*.sh 2>/dev/null || true
chmod +x "${STAGING}/scripts/ubuntu/"*.sh 2>/dev/null || true
chmod +x "${STAGING}/docker/fix-access-url.sh" "${STAGING}/docker/"*.sh 2>/dev/null || true

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

cat > "${STAGING}/MANIFEST.json" <<EOF
{
  "product": "SecuriPDF",
  "version": "${IMAGE_TAG}",
  "stirling_version": "${STIRLING_VERSION}",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "images_archive": "images/securipdf-images.tar",
  "images": [
    "entera-pdf:${IMAGE_TAG}",
    "securipdf-platform:${IMAGE_TAG}",
    "nginx:1.27-alpine",
    "postgres:16-alpine",
    "quay.io/keycloak/keycloak:26.0",
    "quay.io/oauth2-proxy/oauth2-proxy:v7.7.1"
  ],
  "compose": [
    "docker/docker-compose.yml",
    "docker/docker-compose.auth.yml",
    "docker/docker-compose.offline.yml"
  ],
  "install": "cd installer && ./install.sh",
  "install_offline_cli": "./install-offline.sh --load-images --deploy --verify",
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
echo "=== Tamam ==="
echo "Paket: ${OUTPUT_ROOT}/${VERSION_DIR}.tar.gz"
echo "Boyut: $(du -h "${OUTPUT_ROOT}/${VERSION_DIR}.tar.gz" | cut -f1)"
echo ""
echo "Musteri sunucusunda:"
echo "  tar xzf ${VERSION_DIR}.tar.gz"
echo "  cd ${VERSION_DIR}"
echo "  sudo bash scripts/ubuntu/install-prerequisites-offline.sh"
echo "  cd installer && ./install.sh"
