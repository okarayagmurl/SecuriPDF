#!/usr/bin/env bash
# Keycloak realm bootstrap + dogrulama + oauth2-proxy senkronu (kurulum sonrasi).
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${DOCKER_DIR}/.." && pwd)"
ENV_FILE="${DOCKER_DIR}/.env"

COMPOSE=(docker compose
  -f "${DOCKER_DIR}/docker-compose.yml"
  -f "${DOCKER_DIR}/docker-compose.auth.yml"
)
if [[ -f "${ROOT_DIR}/images/securipdf-images.tar" ]] \
  || [[ -f "${ROOT_DIR}/installer/images/securipdf-images.tar" ]] \
  || [[ "${SECURIPDF_OFFLINE:-}" == "1" ]]; then
  COMPOSE+=(-f "${DOCKER_DIR}/docker-compose.offline.yml")
fi

run_ps1() {
  local script="$1"
  shift
  if [[ -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${ENV_FILE}"
    set +a
  fi
  if ! command -v pwsh &>/dev/null; then
    echo "HATA: pwsh gerekli (Keycloak bootstrap)." >&2
    exit 1
  fi
  SECURIPDF_SKIP_KEYCLOAK_WAIT=1 pwsh -NoProfile -File "${DOCKER_DIR}/${script}" "$@"
}

"${DOCKER_DIR}/wait-keycloak.sh"
run_ps1 bootstrap-keycloak-realm.ps1
"${DOCKER_DIR}/verify-keycloak-realm.sh"

echo "[bootstrap-stack-auth] oauth2-proxy yeniden baslatiliyor..."
cd "${DOCKER_DIR}"
"${COMPOSE[@]}" up -d --force-recreate oauth2-proxy

echo "[bootstrap-stack-auth] Tamam."
