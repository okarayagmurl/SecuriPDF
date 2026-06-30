#!/usr/bin/env bash
# SecuriPDF — erisim adreslerini (IP/FQDN) .env icinde senkronize eder
# Kullanim: ./fix-access-url.sh 192.168.6.175
#           ./fix-access-url.sh pdf.sirket.local --https
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
HOST="${1:-}"
HTTPS=0

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Kullanim: $0 <IP veya FQDN> [--https]"
  exit 0
fi

if [[ "${2:-}" == "--https" ]]; then
  HTTPS=1
fi

if [[ -z "${HOST}" ]]; then
  read -r -p "Sunucu IP veya FQDN: " HOST
fi
[[ -n "${HOST}" ]] || { echo "HATA: adres bos" >&2; exit 1; }

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "HATA: ${ENV_FILE} bulunamadi — once cp .env.example .env" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-env.sh"
load_dotenv "${ENV_FILE}"

HTTP_PORT="${HTTP_PORT:-8080}"
KC_PORT="${KEYCLOAK_HTTP_PORT:-8090}"

if [[ "${HTTPS}" -eq 1 ]]; then
  SCHEME=https
  APP_URL="${SCHEME}://${HOST}"
  KC_PUBLIC="${APP_URL}"
  COOKIE_SECURE=true
  INSECURE_ISSUER=false
else
  SCHEME=http
  APP_URL="${SCHEME}://${HOST}:${HTTP_PORT}"
  KC_PUBLIC="${SCHEME}://${HOST}:${KC_PORT}"
  COOKIE_SECURE=false
  INSECURE_ISSUER=true
fi

set_env() {
  local key="$1"
  local val="$2"
  local tmp="${ENV_FILE}.tmp.$$"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    grep -v "^${key}=" "${ENV_FILE}" > "${tmp}"
    printf '%s="%s"\n' "${key}" "${val}" >> "${tmp}"
    mv "${tmp}" "${ENV_FILE}"
  else
    printf '%s="%s"\n' "${key}" "${val}" >> "${ENV_FILE}"
  fi
  rm -f "${tmp}" 2>/dev/null || true
}

set_env PUBLIC_SERVER_IP "${HOST}"
set_env PUBLIC_FQDN "${HOST}"
set_env KEYCLOAK_PUBLIC_FQDN "${HOST}"
set_env KEYCLOAK_HOSTNAME "${HOST}"
set_env OAUTH2_ISSUER_URL "${KC_PUBLIC}/realms/securipdf"
set_env OAUTH2_REDIRECT_URL "${APP_URL}/oauth2/callback"
set_env OAUTH2_LOGIN_URL "${KC_PUBLIC}/realms/securipdf/protocol/openid-connect/auth?ui_locales=tr"
set_env OAUTH2_BACKEND_LOGOUT_URL "http://keycloak:8080/realms/securipdf/protocol/openid-connect/logout?id_token_hint={id_token}&client_id=securipdf&post_logout_redirect_uri=${APP_URL}/"
set_env OAUTH2_SIGN_OUT_REDIRECT_URL "${APP_URL}/"
set_env OAUTH2_COOKIE_SECURE "${COOKIE_SECURE}"
set_env OAUTH2_INSECURE_ISSUER "${INSECURE_ISSUER}"
set_env PUBLIC_USE_HTTPS "$([[ "${HTTPS}" -eq 1 ]] && echo true || echo false)"

# Bos OAUTH2_CLIENT_SECRET oauth2-proxy 500 hatasina yol acar (compose bos string'i default'un onune gecer)
if ! grep -q '^OAUTH2_CLIENT_SECRET=.\+' "${ENV_FILE}"; then
  local oauth_secret
  oauth_secret="$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  set_env OAUTH2_CLIENT_SECRET "${oauth_secret}"
  echo "[fix-access-url] OAUTH2_CLIENT_SECRET uretildi (bootstrap Keycloak ile eslestirir)"
fi

echo "=== Erisim adresleri guncellendi ==="
echo "  Uygulama:  ${APP_URL}"
echo "  Keycloak:  ${KC_PUBLIC}"
echo "  Issuer:    ${KC_PUBLIC}/realms/securipdf"
echo ""

cd "${SCRIPT_DIR}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.auth.yml)
if [[ -f docker-compose.offline.yml ]]; then
  COMPOSE+=(-f docker-compose.offline.yml)
fi

echo "Container'lar yeniden baslatiliyor..."
"${COMPOSE[@]}" up -d --force-recreate oauth2-proxy keycloak securipdf-platform

echo ""
echo "Keycloak realm senkronu (bekleme + bootstrap + dogrulama)..."
if [[ -x "${SCRIPT_DIR}/bootstrap-stack-auth.sh" ]]; then
  bash "${SCRIPT_DIR}/bootstrap-stack-auth.sh"
elif command -v pwsh &>/dev/null; then
  bash "${SCRIPT_DIR}/wait-keycloak.sh"
  pwsh -NoProfile -File "${SCRIPT_DIR}/bootstrap-keycloak-realm.ps1"
  bash "${SCRIPT_DIR}/verify-keycloak-realm.sh"
  "${COMPOSE[@]}" up -d --force-recreate oauth2-proxy
else
  echo "HATA: pwsh ve bootstrap-stack-auth.sh gerekli." >&2
  exit 1
fi

if [[ -x "${SCRIPT_DIR}/verify-auth-urls.sh" ]]; then
  echo ""
  bash "${SCRIPT_DIR}/verify-auth-urls.sh"
fi

echo ""
echo "Dogrulama (.env):"
grep -E '^OAUTH2_(LOGIN_URL|REDIRECT_URL|SIGN_OUT_REDIRECT_URL)=' "${ENV_FILE}" 2>/dev/null || true
if docker inspect securipdf-oauth2-proxy &>/dev/null; then
  docker inspect securipdf-oauth2-proxy --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep -E '^OAUTH2_PROXY_(LOGIN_URL|REDIRECT_URL|SIGN_OUT_REDIRECT_URL)=' || true
fi
if grep -qE '^OAUTH2_(LOGIN_URL|REDIRECT_URL)=http://localhost' "${ENV_FILE}" 2>/dev/null; then
  echo "UYARI: .env hala localhost iceriyor — yukaridaki URL'leri kontrol edin." >&2
fi
echo ""
echo "Tarayici: ${APP_URL}"
