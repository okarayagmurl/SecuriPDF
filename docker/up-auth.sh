#!/usr/bin/env bash
# SecuriPDF — Keycloak + oauth2-proxy + Platform ile baslat (Ubuntu/Linux)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

SKIP_TEST=0
for arg in "$@"; do
  case "${arg}" in
    --skip-test) SKIP_TEST=1 ;;
  esac
done

echo "SecuriPDF tam stack baslatiliyor..."
docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d --build "$@"

echo "Servisler hazirlaniyor..."
sleep 15

run_ps1() {
  local script="$1"
  shift
  if command -v pwsh &>/dev/null; then
    pwsh -NoProfile -File "${SCRIPT_DIR}/${script}" "$@"
  elif command -v powershell &>/dev/null; then
    powershell -NoProfile -File "${SCRIPT_DIR}/${script}" "$@"
  else
    echo "HATA: ${script} icin PowerShell gerekli." >&2
    echo "  sudo INSTALL_PWSH=1 ./scripts/ubuntu/install-prerequisites.sh" >&2
    echo "  veya: sudo apt install powershell" >&2
    exit 1
  fi
}

run_ps1 bootstrap-keycloak-realm.ps1

if [[ "${SKIP_TEST}" -eq 0 ]]; then
  if [[ -x "${SCRIPT_DIR}/test-stack.sh" ]]; then
    "${SCRIPT_DIR}/test-stack.sh"
  else
    run_ps1 test-stack.ps1
  fi
fi

# shellcheck disable=SC1091
[[ -f .env ]] && source ./load-env.sh && load_dotenv .env
HTTP_PORT="${HTTP_PORT:-8080}"

echo ""
echo "SecuriPDF (auth):     http://localhost:${HTTP_PORT}"
echo "Admin UI:             http://localhost:${HTTP_PORT}/admin"
echo "Vault API:            http://localhost:${HTTP_PORT}/api/vault/v1"
echo "Keycloak admin:       http://localhost:${KEYCLOAK_HTTP_PORT:-8090}"
echo "Cikis:                http://localhost:${HTTP_PORT}/oauth2/sign_out"
