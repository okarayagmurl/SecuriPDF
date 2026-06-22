#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

load_offline_images() {
  local tar=""
  for candidate in \
    "${INSTALLER_DIR}/images/securipdf-images.tar" \
    "${ROOT_DIR}/images/securipdf-images.tar" \
    "${ROOT_DIR}"/dist/*/images/securipdf-images.tar; do
    if [[ -f "${candidate}" ]]; then
      tar="${candidate}"
      break
    fi
  done
  [[ -n "${tar}" ]] || die "Offline mod secildi ama securipdf-images.tar bulunamadi"
  log "Image yukleniyor: ${tar}"
  docker load -i "${tar}"
}

deploy_stack() {
  if [[ "${INSTALLER_OFFLINE:-0}" == "1" ]]; then
    load_offline_images
  fi

  if [[ "${INSTALLER_PROD:-0}" == "1" ]]; then
    log "HTTPS modu — TLS sertifikasi kontrol ediliyor..."
    if [[ -x "${DOCKER_DIR}/generate-tls.sh" ]]; then
      "${DOCKER_DIR}/generate-tls.sh"
    else
      die "generate-tls.sh bulunamadi (HTTPS icin zorunlu)"
    fi
  fi

  if [[ -x "${ROOT_DIR}/scripts/sync-tools-config.sh" ]]; then
    log "Arac yapilandirmasi senkronize ediliyor..."
    (cd "${ROOT_DIR}" && ./scripts/sync-tools-config.sh)
  fi

  cd "${DOCKER_DIR}"
  log "Container'lar baslatiliyor..."
  if [[ "${INSTALLER_OFFLINE:-0}" == "1" ]]; then
    compose_cmd up -d --no-build
  else
    compose_cmd up -d --build
  fi

  log "Servisler hazirlaniyor (30 sn)..."
  sleep 30

  log "Keycloak realm bootstrap (LDAP atlanir — Admin panelden yapilir)..."
  run_ps1 bootstrap-keycloak-realm.ps1

  if [[ -x "${DOCKER_DIR}/test-stack.sh" ]]; then
    log "Dogrulama testleri..."
    "${DOCKER_DIR}/test-stack.sh" || warn "Bazi testler basarisiz — LDAP henuz yoksa normal"
  fi
}

print_next_steps() {
  echo ""
  echo "=============================================="
  echo "  SecuriPDF kurulumu tamamlandi"
  echo "=============================================="
  echo ""
  echo "  URL:        ${INSTALLER_APP_URL}"
  echo "  Admin:      ${INSTALLER_APP_URL}/admin"
  echo ""
  echo "  Ilk giris:"
  echo "    Kullanici: securipdf-local-admin"
  echo "    Parola:    (CREDENTIALS dosyasina bakin)"
  echo ""
  echo "  Sonraki adimlar (Admin panel):"
  echo "    1. Active Directory / LDAP bilgilerini girin"
  echo "    2. Baglanti testi"
  echo "    3. Keycloak'a uygula + senkron"
  echo "    4. Operasyon > Ortam ve erisim (FQDN)"
  echo "    5. Kurulum tamamlama checklist (Yapilandirma sekmesi)"
  echo ""
  echo "  Kimlik dosyasi: ${INSTALLER_CRED_FILE}"
  echo "=============================================="
}
