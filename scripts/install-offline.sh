#!/usr/bin/env bash
# SecuriPDF — Kapali ag (offline) kurulum
#
# Kullanim (musteri sunucusu, internet YOK):
#   tar xzf securipdf-*-offline.tar.gz && cd securipdf-*-offline
#   cp docker/.env.example docker/.env && nano docker/.env
#   sudo ./install.sh --prereqs          # ilk sefer: Docker (offline deb paketi gerekir)
#   ./install.sh --load-images --deploy
#   ./install.sh --verify
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"
IMAGES_TAR="${ROOT_DIR}/images/securipdf-images.tar"

DO_PREREQS=0
DO_LOAD=0
DO_DEPLOY=0
DO_VERIFY=0
SKIP_BOOTSTRAP=0

usage() {
  sed -n '2,12p' "$0"
  echo ""
  echo "Ornek:"
  echo "  ./install.sh --load-images --deploy"
  echo "  ./install.sh --verify"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prereqs) DO_PREREQS=1 ;;
    --load-images) DO_LOAD=1 ;;
    --deploy) DO_DEPLOY=1 ;;
    --verify) DO_VERIFY=1 ;;
    --skip-bootstrap) SKIP_BOOTSTRAP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Bilinmeyen arguman: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

if [[ "${DO_PREREQS}" -eq 0 && "${DO_LOAD}" -eq 0 && "${DO_DEPLOY}" -eq 0 && "${DO_VERIFY}" -eq 0 ]]; then
  usage
  exit 1
fi

run_ps1() {
  local script="$1"
  shift
  if command -v pwsh &>/dev/null; then
    pwsh -NoProfile -File "${DOCKER_DIR}/${script}" "$@"
  else
    echo "HATA: ${script} icin PowerShell (pwsh) gerekli." >&2
    echo "Offline pakette pwsh kurulu olmali veya Entera on-imajli VM kullanin." >&2
    exit 1
  fi
}

if [[ "${DO_PREREQS}" -eq 1 ]]; then
  if [[ -x "${ROOT_DIR}/scripts/ubuntu/install-prerequisites-offline.sh" ]]; then
    sudo "${ROOT_DIR}/scripts/ubuntu/install-prerequisites-offline.sh"
  else
    echo "Offline on gereksinim scripti yok." >&2
    echo "Docker onceden kurulu olmali veya install-prerequisites-offline.sh pakete eklenmeli." >&2
    if ! command -v docker &>/dev/null; then
      exit 1
    fi
    echo "Docker mevcut: $(docker --version)"
  fi
fi

if [[ "${DO_LOAD}" -eq 1 ]]; then
  if [[ ! -f "${IMAGES_TAR}" ]]; then
    echo "Image arsivi bulunamadi: ${IMAGES_TAR}" >&2
    exit 1
  fi
  echo "Image'lar yukleniyor (${IMAGES_TAR})..."
  docker load -i "${IMAGES_TAR}"
  echo "Yuklenen image'lar:"
  docker images --format '  {{.Repository}}:{{.Tag}}' | grep -E 'entera-pdf|securipdf-platform|nginx|postgres|keycloak|oauth2-proxy' || true
fi

if [[ "${DO_DEPLOY}" -eq 1 ]]; then
  if [[ ! -f "${DOCKER_DIR}/.env" ]]; then
    echo "docker/.env bulunamadi. Ornek:" >&2
    echo "  cp docker/.env.example docker/.env && nano docker/.env" >&2
    exit 1
  fi

  if [[ -x "${ROOT_DIR}/scripts/sync-tools-config.sh" ]]; then
    echo "Arac yapilandirmasi senkronize ediliyor..."
  (cd "${ROOT_DIR}" && ./scripts/sync-tools-config.sh)
  fi

  cd "${DOCKER_DIR}"
  COMPOSE=(docker compose
    -f docker-compose.yml
    -f docker-compose.auth.yml
    -f docker-compose.offline.yml
  )

  echo "Stack baslatiliyor (offline, build yok)..."
  "${COMPOSE[@]}" up -d --no-build

  echo "Servisler hazirlaniyor..."
  sleep 20

  if [[ "${SKIP_BOOTSTRAP}" -eq 0 ]]; then
    run_ps1 bootstrap-keycloak-realm.ps1
    run_ps1 fix-keycloak-ldap.ps1
  fi
fi

if [[ "${DO_VERIFY}" -eq 1 ]]; then
  cd "${DOCKER_DIR}"
  if [[ -x ./test-stack.sh ]]; then
    ./test-stack.sh
  fi
  if [[ -x "${ROOT_DIR}/scripts/healthcheck.sh" ]]; then
    "${ROOT_DIR}/scripts/healthcheck.sh"
  fi
fi

if [[ "${DO_DEPLOY}" -eq 1 ]]; then
  # shellcheck disable=SC1091
  [[ -f "${DOCKER_DIR}/.env" ]] && set -a && source "${DOCKER_DIR}/.env" && set +a
  HTTP_PORT="${HTTP_PORT:-8080}"
  echo ""
  echo "SecuriPDF (offline): http://localhost:${HTTP_PORT}"
  echo "Admin:               http://localhost:${HTTP_PORT}/admin"
  echo "Keycloak:            http://localhost:${KEYCLOAK_HTTP_PORT:-8090}"
fi
