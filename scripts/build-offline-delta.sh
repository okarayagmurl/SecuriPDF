#!/usr/bin/env bash
# SecuriPDF — surumden surume (path/delta) offline upgrade paketi
#
# Tam paket yerine yalnizca degisen image'lar + script/config.
# Onceki surumde Docker zaten kurulu oldugu icin offline/debs dahil edilmez.
#
# Kullanim:
#   ./scripts/build-offline-delta.sh --from 1.2.0-stirling-2.14.3
#   ./scripts/build-offline-delta.sh --from 1.2.0-stirling-2.14.3 --to 1.2.1-stirling-2.14.3
#   ./scripts/build-offline-delta.sh --from-manifest /path/to/old/MANIFEST.json
#
# Cikti:
#   dist/securipdf-<FROM>_to_<TO>-delta.tar.gz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"
OUTPUT_ROOT="${ROOT_DIR}/dist"
FROM_VERSION=""
TO_VERSION=""
FROM_MANIFEST=""
INCLUDE_UPSTREAM=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM_VERSION="$2"; shift 2 ;;
    --to) TO_VERSION="$2"; shift 2 ;;
    --from-manifest) FROM_MANIFEST="$2"; shift 2 ;;
    --include-upstream) INCLUDE_UPSTREAM=1; shift ;;
    --output) OUTPUT_ROOT="$2"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Bilinmeyen: $1" >&2; exit 1 ;;
  esac
done

if [[ -n "${FROM_MANIFEST}" && -f "${FROM_MANIFEST}" ]]; then
  FROM_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version",""))' "${FROM_MANIFEST}")"
fi
if [[ -z "${FROM_VERSION}" ]]; then
  echo "HATA: --from veya --from-manifest gerekli" >&2
  exit 1
fi

if [[ -f "${ROOT_DIR}/VERSION" ]]; then
  VERSION_FILE_TAG="$(tr -d '[:space:]' < "${ROOT_DIR}/VERSION")"
fi
TO_VERSION="${TO_VERSION:-${IMAGE_TAG:-${VERSION_FILE_TAG:-}}}"
if [[ -z "${TO_VERSION}" ]]; then
  echo "HATA: hedef surum yok (--to veya VERSION)" >&2
  exit 1
fi
if [[ "${FROM_VERSION}" == "${TO_VERSION}" ]]; then
  echo "HATA: from ve to ayni" >&2
  exit 1
fi

STIRLING_VERSION="${STIRLING_VERSION:-$(echo "${TO_VERSION}" | sed -n 's/.*-stirling-//p')}"
STIRLING_VERSION="${STIRLING_VERSION:-2.14.3}"
STIRLING_IMAGE="${STIRLING_IMAGE:-docker.stirlingpdf.com/stirlingtools/stirling-pdf}"
FROM_SAFE="${FROM_VERSION//\//_}"
TO_SAFE="${TO_VERSION//\//_}"
VERSION_DIR="securipdf-${FROM_SAFE}_to_${TO_SAFE}-delta"
STAGING="${OUTPUT_ROOT}/${VERSION_DIR}"
IMAGES_TAR="${STAGING}/images/securipdf-images-delta.tar"

echo "=== SecuriPDF delta paket ==="
echo "From: ${FROM_VERSION}"
echo "To:   ${TO_VERSION}"
echo "Staging: ${STAGING}"

command -v docker &>/dev/null || { echo "HATA: docker yok" >&2; exit 1; }
docker info &>/dev/null || { echo "HATA: docker daemon yok" >&2; exit 1; }

rm -rf "${STAGING}"
mkdir -p "${STAGING}/images"

cd "${DOCKER_DIR}"
export IMAGE_TAG="${TO_VERSION}"
export STIRLING_VERSION
export SECURIPDF_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

PLATFORM_UI_VER="$(grep -oE 'app\.js\?v=[0-9]+' "${ROOT_DIR}/services/platform/app/static/app/index.html" | grep -oE '[0-9]+' || echo 0)"

echo "[1/4] Image build (entera-pdf + platform)..."
docker compose -f docker-compose.yml -f docker-compose.auth.yml build entera-pdf securipdf-platform

DELTA_REFS=(
  "entera-pdf:${TO_VERSION}"
  "securipdf-platform:${TO_VERSION}"
)

FROM_STIRLING="$(echo "${FROM_VERSION}" | sed -n 's/.*-stirling-//p')"
if [[ "${INCLUDE_UPSTREAM}" -eq 1 || "${FROM_STIRLING}" != "${STIRLING_VERSION}" ]]; then
  echo "[+] Stirling/upstream degisikligi — ek image'lar dahil"
  docker pull "${STIRLING_IMAGE}:${STIRLING_VERSION}-fat" || true
  docker pull "nginx:1.27-alpine"
  docker pull "postgres:16-alpine"
  docker pull "quay.io/keycloak/keycloak:26.0"
  docker pull "quay.io/oauth2-proxy/oauth2-proxy:v7.8.2"
  DELTA_REFS+=(
    "${STIRLING_IMAGE}:${STIRLING_VERSION}-fat"
    "nginx:1.27-alpine"
    "postgres:16-alpine"
    "quay.io/keycloak/keycloak:26.0"
    "quay.io/oauth2-proxy/oauth2-proxy:v7.8.2"
  )
fi

echo "[2/4] Delta image arsivi..."
docker save -o "${IMAGES_TAR}" "${DELTA_REFS[@]}"
echo "  -> $(du -h "${IMAGES_TAR}" | cut -f1)"

echo "[3/4] Script/config kopya (debs yok)..."
copy_tree() {
  local src="$1" dst="$2"
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
mkdir -p "${STAGING}/docs"
cp "${ROOT_DIR}/docs/UPDATE.md" "${STAGING}/docs/" 2>/dev/null || true
cp "${ROOT_DIR}/docs/TROUBLESHOOTING.md" "${STAGING}/docs/" 2>/dev/null || true
cp "${DOCKER_DIR}/.env.offline.example" "${STAGING}/docker/.env.example"
chmod +x "${STAGING}/scripts/upgrade-offline-stack.sh" 2>/dev/null || true
chmod +x "${STAGING}/scripts/securipdf-updater/"*.sh 2>/dev/null || true
chmod +x "${STAGING}/docker/"*.sh 2>/dev/null || true

IMAGES_JSON="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "${DELTA_REFS[@]}")"

cat > "${STAGING}/MANIFEST.json" <<EOF
{
  "product": "SecuriPDF",
  "package_kind": "delta",
  "version": "${TO_VERSION}",
  "from_version": "${FROM_VERSION}",
  "stirling_version": "${STIRLING_VERSION}",
  "built_at": "${SECURIPDF_BUILT_AT}",
  "min_upgrade_from": "${FROM_VERSION}",
  "upgrade_from": ["${FROM_VERSION}"],
  "platform_ui": ${PLATFORM_UI_VER},
  "oauth2_proxy": "v7.8.2",
  "keycloak": "26.0",
  "changelog": "Delta upgrade ${FROM_VERSION} -> ${TO_VERSION}",
  "images_archive": "images/securipdf-images-delta.tar",
  "images": ${IMAGES_JSON},
  "compose": [
    "docker/docker-compose.yml",
    "docker/docker-compose.auth.yml",
    "docker/docker-compose.offline.yml"
  ],
  "upgrade_cli": "sudo bash scripts/upgrade-offline-stack.sh",
  "note": "Yalnizca ${FROM_VERSION} kurulumundan uygulanir. Sifir kurulum icin full offline paket kullanin."
}
EOF

echo "[4/4] Arsiv..."
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
echo "Delta: ${OUTPUT_ROOT}/${VERSION_DIR}.tar.gz"
echo "Boyut: $(du -h "${OUTPUT_ROOT}/${VERSION_DIR}.tar.gz" | cut -f1)"
echo ""
echo "Musteri (mevcut ${FROM_VERSION}):"
echo "  tar xzf ${VERSION_DIR}.tar.gz"
echo "  cd ${VERSION_DIR}"
echo "  # docker/.env mevcut kurulumdan kopyalanmali (updater otomatik yapar)"
echo "  sudo bash scripts/upgrade-offline-stack.sh"
