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
DO_UPGRADE=0
SKIP_BOOTSTRAP=0

usage() {
  sed -n '2,12p' "$0"
  echo ""
  echo "Ornek:"
  echo "  ./install.sh --load-images --deploy"
  echo "  ./install.sh --verify"
  echo "  ./install.sh --upgrade   # mevcut kurulumu yeni paketle guncelle"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prereqs) DO_PREREQS=1 ;;
    --load-images) DO_LOAD=1 ;;
    --deploy) DO_DEPLOY=1 ;;
    --verify) DO_VERIFY=1 ;;
    --upgrade) DO_UPGRADE=1 ;;
    --skip-bootstrap) SKIP_BOOTSTRAP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Bilinmeyen arguman: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

if [[ "${DO_PREREQS}" -eq 0 && "${DO_LOAD}" -eq 0 && "${DO_DEPLOY}" -eq 0 && "${DO_VERIFY}" -eq 0 && "${DO_UPGRADE}" -eq 0 ]]; then
  usage
  exit 1
fi

if [[ "${DO_UPGRADE}" -eq 1 ]]; then
  UPGRADE="${ROOT_DIR}/scripts/upgrade-offline-stack.sh"
  [[ -x "${UPGRADE}" ]] || chmod +x "${UPGRADE}"
  exec bash "${UPGRADE}"
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
  # shellcheck disable=SC1091
  source "${DOCKER_DIR}/load-env.sh"
  load_dotenv "${DOCKER_DIR}/.env"
  if [[ -z "${OAUTH2_CLIENT_SECRET:-}" ]]; then
    echo "HATA: OAUTH2_CLIENT_SECRET bos — oauth2-proxy 500 (unauthorized_client) verir." >&2
    echo "  .env dosyasinda guclu bir secret tanimlayin, sonra:" >&2
    echo "  cd docker && ./fix-access-url.sh SUNUCU_IP" >&2
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
  sleep 10

  if [[ "${SKIP_BOOTSTRAP}" -eq 0 ]]; then
    chmod +x "${DOCKER_DIR}/wait-keycloak.sh" "${DOCKER_DIR}/verify-keycloak-realm.sh" "${DOCKER_DIR}/bootstrap-stack-auth.sh" 2>/dev/null || true
    "${DOCKER_DIR}/bootstrap-stack-auth.sh"
    if [[ -n "${LDAP_BIND_PASSWORD:-}" ]]; then
      run_ps1 fix-keycloak-ldap.ps1
    else
      echo "LDAP_BIND_PASSWORD bos — LDAP script atlandi (Admin panelden yapilandirin)."
    fi
  fi
fi

if [[ "${DO_VERIFY}" -eq 1 ]]; then
  cd "${DOCKER_DIR}"
  if [[ -x ./verify-auth-urls.sh ]]; then
    ./verify-auth-urls.sh
  fi
  if [[ -x ./test-stack.sh ]]; then
    ./test-stack.sh
  fi
  if [[ -x "${ROOT_DIR}/scripts/healthcheck.sh" ]]; then
    "${ROOT_DIR}/scripts/healthcheck.sh"
  fi
fi

if [[ "${DO_DEPLOY}" -eq 1 ]]; then
  # shellcheck disable=SC1091
  if [[ -f "${DOCKER_DIR}/.env" ]]; then
    source "${DOCKER_DIR}/load-env.sh"
    load_dotenv "${DOCKER_DIR}/.env"
  fi
  HTTP_PORT="${HTTP_PORT:-8080}"
  APP_HOST="${PUBLIC_FQDN:-${KEYCLOAK_HOSTNAME:-localhost}}"
  echo ""
  echo "SecuriPDF (offline): http://${APP_HOST}:${HTTP_PORT}"
  echo "Admin:               http://${APP_HOST}:${HTTP_PORT}/admin"
  echo "Keycloak:            http://${APP_HOST}:${KEYCLOAK_HTTP_PORT:-8090}"
fi
