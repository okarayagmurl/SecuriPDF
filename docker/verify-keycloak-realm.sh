#!/usr/bin/env bash
# securipdf realm ve temel OIDC endpoint'lerini dogrular.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/load-env.sh"
  load_dotenv "${ENV_FILE}"
fi

KC_PORT="${KEYCLOAK_HTTP_PORT:-8090}"
REALM="${KEYCLOAK_REALM:-securipdf}"
BASE="http://127.0.0.1:${KC_PORT}"

check_url() {
  local url="$1"
  local label="$2"
  if curl -sf --max-time 5 "${url}" >/dev/null; then
    echo "[verify-keycloak] OK: ${label}"
    return 0
  fi
  echo "[verify-keycloak] HATA: ${label} — ${url}" >&2
  return 1
}

fail=0
check_url "${BASE}/realms/${REALM}" "realm ${REALM}" || fail=1
check_url "${BASE}/realms/${REALM}/.well-known/openid-configuration" "OIDC discovery" || fail=1

if [[ "${fail}" -ne 0 ]]; then
  echo "[verify-keycloak] Bootstrap tamamlanmamis veya basarisiz." >&2
  echo "  cd docker && pwsh -NoProfile -File bootstrap-keycloak-realm.ps1" >&2
  exit 1
fi

echo "[verify-keycloak] Realm dogrulandi."
