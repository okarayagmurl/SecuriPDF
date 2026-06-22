#!/usr/bin/env bash
# SecuriPDF - Sağlık kontrolü (direct + auth stack)
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

HTTP_PORT="${HTTP_PORT:-8080}"
MAX_RETRIES="${HEALTHCHECK_RETRIES:-30}"
INTERVAL="${HEALTHCHECK_INTERVAL:-5}"

check_url() {
  local url="$1"
  local name="$2"
  if curl -sf --max-time 10 "${url}" >/dev/null 2>&1; then
    echo "  OK  ${name}: ${url}"
    return 0
  else
    echo "  FAIL ${name}: ${url}"
    return 1
  fi
}

check_docker_exec() {
  local container="$1"
  local cmd="$2"
  local name="$3"
  if docker exec "${container}" sh -c "${cmd}" >/dev/null 2>&1; then
    echo "  OK  ${name}"
    return 0
  else
    echo "  FAIL ${name}"
    return 1
  fi
}

echo "=== SecuriPDF Healthcheck ==="
echo "Container durumu:"
docker compose ps 2>/dev/null || docker compose -f docker-compose.yml -f docker-compose.auth.yml ps

AUTH_MODE=0
if docker ps --format '{{.Names}}' | grep -q 'securipdf-oauth2-proxy'; then
  AUTH_MODE=1
  echo ""
  echo "Mod: Auth stack (oauth2-proxy)"
fi

FAILED=0
for i in $(seq 1 "${MAX_RETRIES}"); do
  echo ""
  echo "Deneme ${i}/${MAX_RETRIES}..."

  if [[ "${AUTH_MODE}" -eq 1 ]]; then
    check_docker_exec "securipdf-postgres" "pg_isready -U keycloak -d keycloak" "Postgres" || FAILED=1
    check_docker_exec "entera-nginx" "wget -qO- http://127.0.0.1:8080/nginx-health" "Nginx (internal)" || FAILED=1
    check_docker_exec "securipdf-platform" "curl -sf http://127.0.0.1:8000/health" "Platform (Vault/Admin)" || FAILED=1
    check_docker_exec "securipdf-keycloak" "timeout 2 sh -c 'cat < /dev/null > /dev/tcp/127.0.0.1/8080'" "Keycloak" || FAILED=1
    check_url "http://localhost:${HTTP_PORT}/api/license/v1/status" "License API (public)" || true
    if docker exec entera-nginx wget -qO- \
      --header="X-Auth-Request-User: healthcheck" \
      --header="X-Auth-Request-Groups: pdf-admin" \
      http://127.0.0.1:8080/api/vault/v1/admin/ldap/test >/dev/null 2>&1; then
      echo "  OK  Admin API (simulated)"
    else
      echo "  FAIL Admin API (simulated)"
      FAILED=1
    fi
  else
    check_url "http://localhost:${HTTP_PORT}/nginx-health" "Nginx" || FAILED=1
    check_url "http://localhost:${HTTP_PORT}/api/v1/info/status" "Stirling API" || FAILED=1
    check_docker_exec "securipdf-platform" "curl -sf http://127.0.0.1:8000/health" "Platform" || true
  fi

  if [[ "${FAILED}" -eq 0 ]]; then
    echo ""
    echo "Tüm kontroller başarılı."
    exit 0
  fi
  FAILED=0
  sleep "${INTERVAL}"
done

echo ""
echo "Hata: Healthcheck başarısız." >&2
exit 1
