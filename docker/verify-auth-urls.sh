#!/usr/bin/env bash
# oauth2-proxy ve .env erisim URL'lerini dogrular (logout dahil).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
FAIL=0

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/load-env.sh"
  load_dotenv "${ENV_FILE}"
fi

HTTP_PORT="${HTTP_PORT:-8080}"

check_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if [[ "${haystack}" == *"${needle}"* ]]; then
    echo "[verify-auth-urls] OK: ${label}"
    return 0
  fi
  echo "[verify-auth-urls] HATA: ${label} — '${needle}' bulunamadi" >&2
  echo "  Deger: ${haystack}" >&2
  FAIL=1
  return 1
}

echo "[verify-auth-urls] OAuth URL dogrulamasi..."

if [[ -z "${OAUTH2_BACKEND_LOGOUT_URL:-}" ]]; then
  echo "[verify-auth-urls] HATA: OAUTH2_BACKEND_LOGOUT_URL bos" >&2
  FAIL=1
else
  check_contains "${OAUTH2_BACKEND_LOGOUT_URL}" "id_token_hint={id_token}" "backend logout id_token_hint (.env)"
  check_contains "${OAUTH2_BACKEND_LOGOUT_URL}" "client_id=securipdf" "backend logout client_id (.env)"
fi

if [[ -z "${OAUTH2_SIGN_OUT_REDIRECT_URL:-}" ]]; then
  echo "[verify-auth-urls] HATA: OAUTH2_SIGN_OUT_REDIRECT_URL bos" >&2
  FAIL=1
fi

if docker inspect securipdf-oauth2-proxy &>/dev/null; then
  proxy_sign_out="$(docker inspect securipdf-oauth2-proxy --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep '^OAUTH2_PROXY_SIGN_OUT_REDIRECT_URL=' | cut -d= -f2- || true)"
  proxy_backend="$(docker inspect securipdf-oauth2-proxy --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep '^OAUTH2_PROXY_BACKEND_LOGOUT_URL=' | cut -d= -f2- || true)"
  if [[ -z "${proxy_sign_out}" ]]; then
    echo "[verify-auth-urls] HATA: oauth2-proxy SIGN_OUT_REDIRECT_URL yok" >&2
    FAIL=1
  fi
  if [[ -z "${proxy_backend}" ]]; then
    echo "[verify-auth-urls] HATA: oauth2-proxy BACKEND_LOGOUT_URL yok" >&2
    FAIL=1
  else
    check_contains "${proxy_backend}" "id_token_hint={id_token}" "backend logout id_token_hint (container)"
  fi
else
  echo "[verify-auth-urls] UYARI: securipdf-oauth2-proxy calismiyor" >&2
  FAIL=1
fi

if curl -sfI --max-time 5 "http://127.0.0.1:${HTTP_PORT}/" 2>/dev/null | grep -qi '^location:.*openid-connect/auth'; then
  echo "[verify-auth-urls] OK: oturumsuz istek Keycloak login'e yonleniyor"
else
  echo "[verify-auth-urls] HATA: ${HTTP_PORT} oturumsuz istek login'e yonlenmiyor" >&2
  FAIL=1
fi

if [[ "${FAIL}" -ne 0 ]]; then
  echo "[verify-auth-urls] Basarisiz — fix-access-url.sh SUNUCU_IP calistirin." >&2
  exit 1
fi

echo "[verify-auth-urls] Tamam."
