#!/usr/bin/env bash
# Entera PDF - Rollback scripti
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"

cd "${DOCKER_DIR}"

ROLLBACK_TAG=""
if [[ -f "${ROOT_DIR}/.last-rollback-tag" ]]; then
  ROLLBACK_TAG="$(cat "${ROOT_DIR}/.last-rollback-tag")"
fi

if [[ -z "${ROLLBACK_TAG}" ]]; then
  echo "Mevcut rollback etiketleri:"
  docker images "entera-pdf" --format "  {{.Tag}}\t{{.CreatedSince}}" | grep rollback || true
  echo ""
  read -r -p "Rollback etiketi girin (örn. 1.1.0-stirling-2.13.1-rollback-...): " ROLLBACK_TAG
fi

if [[ -z "${ROLLBACK_TAG}" ]]; then
  echo "Hata: Rollback etiketi belirtilmedi." >&2
  exit 1
fi

if ! docker image inspect "entera-pdf:${ROLLBACK_TAG}" &>/dev/null; then
  echo "Hata: entera-pdf:${ROLLBACK_TAG} image bulunamadı." >&2
  exit 1
fi

echo "=== Entera PDF Rollback ==="
echo "Hedef image: entera-pdf:${ROLLBACK_TAG}"
read -r -p "Devam? (evet/hayır): " CONFIRM
[[ "${CONFIRM}" == "evet" ]] || { echo "İptal."; exit 0; }

# .env içindeki IMAGE_TAG'i güncelle
if [[ -f .env ]]; then
  if grep -q "^IMAGE_TAG=" .env; then
    sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=${ROLLBACK_TAG}/" .env
  else
    echo "IMAGE_TAG=${ROLLBACK_TAG}" >> .env
  fi
fi

# Compose'da image tag override
export IMAGE_TAG="${ROLLBACK_TAG}"

docker compose down
docker compose up -d

sleep 10
bash "${SCRIPT_DIR}/healthcheck.sh" || {
  echo "Uyarı: Rollback sonrası healthcheck başarısız." >&2
  exit 1
}

echo "Rollback tamamlandı: entera-pdf:${ROLLBACK_TAG}"
