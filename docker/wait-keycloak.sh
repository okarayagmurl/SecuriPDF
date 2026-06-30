#!/usr/bin/env bash
# Keycloak HTTP hazir olana kadar bekler (kurulum / bootstrap oncesi).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1091
  source "${DOCKER_DIR}/load-env.sh"
  load_dotenv "${ENV_FILE}"
fi

KC_PORT="${KEYCLOAK_HTTP_PORT:-8090}"
MAX_ATTEMPTS="${KEYCLOAK_WAIT_ATTEMPTS:-72}"
SLEEP_SEC="${KEYCLOAK_WAIT_SLEEP:-5}"

keycloak_http_ready() {
  curl -sf --max-time 3 "http://127.0.0.1:${KC_PORT}/health/ready" >/dev/null 2>&1 \
    || curl -sf --max-time 3 "http://127.0.0.1:${KC_PORT}/realms/master" >/dev/null 2>&1
}

keycloak_container_running() {
  docker ps --filter name=^securipdf-keycloak$ --filter status=running -q | grep -q .
}

echo "[wait-keycloak] Keycloak bekleniyor (127.0.0.1:${KC_PORT}, en fazla $((MAX_ATTEMPTS * SLEEP_SEC)) sn)..."

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  if keycloak_http_ready; then
    echo "[wait-keycloak] Hazir."
    exit 0
  fi

  if ! keycloak_container_running; then
    echo "[wait-keycloak] HATA: securipdf-keycloak calismiyor." >&2
    docker ps -a --filter name=securipdf-keycloak >&2 || true
    docker logs securipdf-keycloak --tail 50 >&2 || true
    exit 1
  fi

  if (( attempt == 1 || attempt % 6 == 0 )); then
    echo "[wait-keycloak] ... hala bekleniyor ($((attempt * SLEEP_SEC)) sn)"
  fi
  sleep "${SLEEP_SEC}"
done

echo "[wait-keycloak] HATA: zaman asimi — Keycloak HTTP yanit vermiyor." >&2
docker logs securipdf-keycloak --tail 80 >&2
exit 1
