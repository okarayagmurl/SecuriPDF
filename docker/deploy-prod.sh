#!/usr/bin/env bash
# SecuriPDF — Prod ortam deploy (TLS edge + sertlestirme)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

FORCE=0
SKIP_HARDENING=0
SKIP_BOOTSTRAP=0
EXTRA_ARGS=()

for arg in "$@"; do
  case "${arg}" in
    --force|-f) FORCE=1 ;;
    --skip-hardening) SKIP_HARDENING=1 ;;
    --skip-bootstrap) SKIP_BOOTSTRAP=1 ;;
    *) EXTRA_ARGS+=("${arg}") ;;
  esac
done

if [[ "${SKIP_HARDENING}" -eq 0 ]]; then
  HARDEN_ARGS=()
  [[ "${FORCE}" -eq 1 ]] && HARDEN_ARGS+=(--force)
  "${SCRIPT_DIR}/apply-prod-hardening.sh" "${HARDEN_ARGS[@]}"
fi

echo "Prod stack baslatiliyor (TLS edge nginx:443)..."
docker compose -f docker-compose.yml -f docker-compose.auth.yml -f docker-compose.prod.yml up -d --build "${EXTRA_ARGS[@]}"

echo "Servisler hazirlaniyor..."
sleep 20

if [[ "${SKIP_BOOTSTRAP}" -eq 0 ]]; then
  if command -v pwsh &>/dev/null; then
    pwsh -NoProfile -File "${SCRIPT_DIR}/bootstrap-keycloak-realm.ps1"
  else
    echo "Bootstrap atlandi (pwsh yok). Manuel: pwsh bootstrap-keycloak-realm.ps1"
  fi
fi

"${SCRIPT_DIR}/test-stack.sh"

echo ""
echo "SecuriPDF (prod):     https://localhost (veya PUBLIC_HOSTNAME)"
echo "Admin UI:             https://localhost/admin"
echo "Not: OAUTH2_REDIRECT_URL ve Keycloak redirect URI'leri https olmalidir."
