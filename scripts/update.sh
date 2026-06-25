#!/usr/bin/env bash
# Entera PDF - Güncelleme scripti
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"

cd "${DOCKER_DIR}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

echo "=== Entera PDF Güncelleme ==="

# Mevcut image'ı etiketle (rollback için)
CURRENT_TAG="${IMAGE_TAG:-1.1.0-stirling-2.13.1}"
ROLLBACK_TAG="${CURRENT_TAG}-rollback-$(date +%Y%m%d%H%M%S)"

if docker image inspect "entera-pdf:${CURRENT_TAG}" &>/dev/null; then
  echo "Rollback etiketi oluşturuluyor: entera-pdf:${ROLLBACK_TAG}"
  docker tag "entera-pdf:${CURRENT_TAG}" "entera-pdf:${ROLLBACK_TAG}"
  echo "${ROLLBACK_TAG}" > "${ROOT_DIR}/.last-rollback-tag"
fi

# Upstream versiyon kontrolü
echo ""
echo "Upstream Stirling-PDF sürümü: ${STIRLING_VERSION:-2.13.1}"
echo "Hedef image: ${STIRLING_IMAGE:-docker.stirlingpdf.com/stirlingtools/stirling-pdf}:${STIRLING_VERSION:-2.13.1}-fat"

# Config senkronizasyonu
if [[ -x "${SCRIPT_DIR}/sync-tools-config.sh" ]]; then
  echo ""
  echo "Araç yapılandırması senkronize ediliyor..."
  bash "${SCRIPT_DIR}/sync-tools-config.sh"
fi

# Image build
echo ""
echo "Image derleniyor..."
docker compose build --no-cache entera-pdf

# Compose güncelleme
echo ""
echo "Servisler güncelleniyor..."
docker compose pull nginx 2>/dev/null || true
docker compose up -d --remove-orphans

# Healthcheck
echo ""
echo "Healthcheck doğrulanıyor..."
sleep 15
if bash "${SCRIPT_DIR}/healthcheck.sh"; then
  echo ""
  echo "Güncelleme başarılı: entera-pdf:${CURRENT_TAG}"
else
  echo ""
  echo "Uyarı: Healthcheck başarısız. Rollback için:"
  echo "  ./scripts/rollback.sh"
  exit 1
fi
