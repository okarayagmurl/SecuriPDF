#!/usr/bin/env bash
# SecuriPDF — stack dogrulama (Ubuntu/Linux)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

FAIL=0

step() {
  local name="$1"
  shift
  if "$@"; then
    echo "[OK] ${name}"
  else
    echo "[FAIL] ${name}" >&2
    FAIL=$((FAIL + 1))
  fi
}

test_platform_health() {
  local out
  out="$(docker exec securipdf-platform curl -sf http://127.0.0.1:8000/health)"
  [[ "${out}" == *'"status":"ok"'* ]]
}

test_license() {
  local out
  out="$(docker exec securipdf-platform curl -sf http://127.0.0.1:8000/api/license/v1/status)"
  [[ "${out}" == *'"valid":true'* ]] || [[ "${out}" == *'"valid": true'* ]]
}

test_vault_quota() {
  local out
  out="$(docker exec entera-nginx wget -qO- \
    --header="X-Auth-Request-User: test-user" \
    --header="X-Auth-Request-Groups: pdf-user" \
    http://127.0.0.1:8080/api/vault/v1/quota 2>/dev/null || true)"
  [[ "${out}" == *maxBytes* ]]
}

test_admin_settings() {
  local out
  out="$(docker exec entera-nginx wget -qO- \
    --header="X-Auth-Request-User: admin-test" \
    --header="X-Auth-Request-Groups: pdf-admin" \
    http://127.0.0.1:8080/api/vault/v1/admin/settings 2>/dev/null || true)"
  [[ "${out}" == *'"ldap"'* ]]
}

test_admin_ldap() {
  local out
  out="$(docker exec entera-nginx wget -qO- \
    --header="X-Auth-Request-User: admin-test" \
    --header="X-Auth-Request-Groups: pdf-admin" \
    http://127.0.0.1:8080/api/vault/v1/admin/ldap/test 2>/dev/null || true)"
  [[ "${out}" == *'"ok"'* ]]
}

test_nginx() {
  docker exec entera-nginx wget -qO- http://127.0.0.1:8080/nginx-health >/dev/null 2>&1
}

test_keycloak() {
  local kc_port="${KEYCLOAK_HTTP_PORT:-8090}"
  curl -sf --max-time 5 "http://127.0.0.1:${kc_port}/health/ready" >/dev/null 2>&1 \
    || curl -sf --max-time 5 "http://127.0.0.1:${kc_port}/realms/master" >/dev/null 2>&1
}

test_postgres() {
  docker exec securipdf-postgres pg_isready -U keycloak -d keycloak >/dev/null 2>&1
}

test_oauth_sign_out_url() {
  local env_val proxy_val
  env_val="$(grep '^OAUTH2_SIGN_OUT_REDIRECT_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  [[ "${env_val}" == *post_logout_redirect_uri=* ]] || return 1
  proxy_val="$(docker inspect securipdf-oauth2-proxy --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep '^OAUTH2_PROXY_SIGN_OUT_REDIRECT_URL=' | cut -d= -f2- || true)"
  [[ "${proxy_val}" == *post_logout_redirect_uri=* ]]
}

test_unauth_redirect() {
  local port="${HTTP_PORT:-8080}"
  curl -sfI --max-time 5 "http://127.0.0.1:${port}/" 2>/dev/null | grep -qi '^location:.*openid-connect/auth'
}

# shellcheck disable=SC1091
[[ -f .env ]] && source ./load-env.sh && load_dotenv .env

step "Platform health" test_platform_health
step "License API" test_license
step "Vault quota (simulated auth)" test_vault_quota
step "Admin settings API" test_admin_settings
step "Admin LDAP test API" test_admin_ldap
step "Nginx health" test_nginx
step "Keycloak" test_keycloak
step "Postgres" test_postgres
step "OAuth sign-out URL" test_oauth_sign_out_url
step "Unauthenticated login redirect" test_unauth_redirect

if [[ "${FAIL}" -gt 0 ]]; then
  echo ""
  echo "${FAIL} test basarisiz" >&2
  exit 1
fi

echo ""
echo "Tum testler gecti."
