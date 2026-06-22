#!/usr/bin/env bash
# SecuriPDF — Kurulum sihirbazi (minimal soru, geri kalan Admin panelde)
#
# Kullanim:
#   cd SecuriPDF/installer
#   ./install.sh
#
# Offline (image arsivi installer/images/ veya dist/ altinda):
#   ./install.sh
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "${LIB_DIR}/common.sh"

SKIP_WIZARD=0
for arg in "$@"; do
  case "${arg}" in
    --yes|-y) SKIP_WIZARD=1; INSTALLER_HOST="${INSTALLER_HOST:-localhost}"; INSTALLER_PROD=0; INSTALLER_HTTP_PORT=8080; INSTALLER_KEYCLOAK_PORT=8090; INSTALLER_OFFLINE=0; INSTALLER_BREAK_GLASS="SecuriPDF-Install-2026!" ;;
    -h|--help)
      echo "Kullanim: ./install.sh [--yes]"
      exit 0
      ;;
  esac
done

# shellcheck source=lib/preflight.sh
source "${LIB_DIR}/preflight.sh"
# shellcheck source=lib/wizard.sh
source "${LIB_DIR}/wizard.sh"
# shellcheck source=lib/write-env.sh
source "${LIB_DIR}/write-env.sh"
# shellcheck source=lib/deploy.sh
source "${LIB_DIR}/deploy.sh"

main() {
  preflight
  if [[ "${SKIP_WIZARD}" -eq 0 ]]; then
    run_wizard
  else
    export INSTALLER_SCHEME=http INSTALLER_COOKIE_SECURE=false INSTALLER_INSECURE_ISSUER=true INSTALLER_HTTPS_PORT=443
  fi
  write_env
  deploy_stack
  print_next_steps
}

main "$@"
