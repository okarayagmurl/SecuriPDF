#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

run_wizard() {
  echo ""
  echo "=== SecuriPDF Kurulum Sihirbazi ==="
  echo "LDAP, SMTP ve diger ayarlar kurulum sonrasi Admin panelinden yapilir."
  echo ""

  INSTALLER_HOST="$(prompt_default "Sunucu adresi (FQDN veya IP)" "localhost")"
  if prompt_yes_no "HTTPS (prod) modu?" "n"; then
    INSTALLER_PROD=1
    INSTALLER_HTTP_PORT=80
    INSTALLER_HTTPS_PORT=443
    INSTALLER_SCHEME=https
    INSTALLER_COOKIE_SECURE=true
    INSTALLER_INSECURE_ISSUER=false
  else
    INSTALLER_PROD=0
    INSTALLER_HTTP_PORT="$(prompt_default "HTTP port" "8080")"
    INSTALLER_HTTPS_PORT=443
    INSTALLER_SCHEME=http
    INSTALLER_COOKIE_SECURE=false
    INSTALLER_INSECURE_ISSUER=true
  fi

  INSTALLER_KEYCLOAK_PORT="$(prompt_default "Keycloak yonetim portu (dis erisim)" "8090")"

  local offline_tar=""
  if [[ -f "${INSTALLER_DIR}/images/securipdf-images.tar" ]]; then
    offline_tar=1
  elif [[ -f "${ROOT_DIR}/images/securipdf-images.tar" ]]; then
    offline_tar=1
  else
    for f in "${ROOT_DIR}"/dist/*/images/securipdf-images.tar; do
      if [[ -f "${f}" ]]; then offline_tar=1; break; fi
    done
  fi
  if [[ -n "${offline_tar}" ]]; then
    INSTALLER_OFFLINE=1
    log "Offline image arsivi bulundu — yerel yukleme kullanilacak"
  elif prompt_yes_no "Offline image yuklemesi var mi?" "n"; then
    INSTALLER_OFFLINE=1
  else
    INSTALLER_OFFLINE=0
  fi

  local default_bg="SecuriPDF-Install-2026!"
  echo ""
  echo "Ilk giris kullanicisi: securipdf-local-admin (Keycloak, AD disi)"
  if prompt_yes_no "Varsayilan kurulum parolasi kullanilsin mi? (${default_bg})" "y"; then
    INSTALLER_BREAK_GLASS="${default_bg}"
  else
    read -r -s -p "Kurulum parolasi: " INSTALLER_BREAK_GLASS
    echo ""
    [[ -n "${INSTALLER_BREAK_GLASS}" ]] || die "Parola bos olamaz"
  fi

  export INSTALLER_HOST INSTALLER_PROD INSTALLER_HTTP_PORT INSTALLER_HTTPS_PORT
  export INSTALLER_SCHEME INSTALLER_COOKIE_SECURE INSTALLER_INSECURE_ISSUER
  export INSTALLER_KEYCLOAK_PORT INSTALLER_OFFLINE INSTALLER_BREAK_GLASS
}
