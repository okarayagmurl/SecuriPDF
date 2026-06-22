#!/usr/bin/env bash
# SecuriPDF - Geri yükleme (direct + auth stack)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"

usage() {
  echo "Kullanım: $0 <yedek_klasörü>"
  echo "Ortam: RESTORE_SKIP_CONFIRM=1  AUTH_STACK=1"
  exit 1
}

[[ $# -ge 1 ]] || usage
BACKUP_DIR="$(cd "$1" && pwd)"

if [[ ! -d "${BACKUP_DIR}" ]]; then
  echo "Hata: Yedek klasörü bulunamadı: ${BACKUP_DIR}" >&2
  exit 1
fi

AUTH_STACK="${AUTH_STACK:-0}"
if [[ -f "${BACKUP_DIR}/.env" ]] && grep -q "OAUTH2_CLIENT_SECRET" "${BACKUP_DIR}/.env" 2>/dev/null; then
  AUTH_STACK=1
fi

echo "=== SecuriPDF Geri Yükleme ==="
echo "Kaynak: ${BACKUP_DIR}"
echo "Auth stack: ${AUTH_STACK}"

if [[ "${RESTORE_SKIP_CONFIRM:-0}" != "1" ]]; then
  read -r -p "Devam etmek istiyor musunuz? (evet/hayır): " CONFIRM
  [[ "${CONFIRM}" == "evet" ]] || { echo "İptal edildi."; exit 0; }
fi

restore_volume() {
  local vol_name="$1"
  local archive_name="$2"
  local archive_path="${BACKUP_DIR}/${archive_name}"
  if [[ -f "${archive_path}" ]]; then
    echo "  Geri yükleniyor: ${vol_name}"
    docker volume create "${vol_name}" &>/dev/null || true
    docker run --rm \
      -v "${vol_name}:/data" \
      -v "${BACKUP_DIR}:/backup:ro" \
      alpine sh -c "rm -rf /data/* && tar -xzf /backup/${archive_name} -C /data"
  fi
}

if [[ -f "${BACKUP_DIR}/config.tar.gz" ]]; then
  echo "[1/6] Config geri yükleniyor..."
  tar -xzf "${BACKUP_DIR}/config.tar.gz" -C "${ROOT_DIR}"
fi

if [[ -f "${BACKUP_DIR}/.env" ]]; then
  cp "${BACKUP_DIR}/.env" "${DOCKER_DIR}/.env"
fi

echo "[2/6] Stirling volume'ları..."
restore_volume "entera-pdf_entera_config" "volume_config.tar.gz"
restore_volume "entera-pdf_entera_data" "volume_data.tar.gz"
restore_volume "entera-pdf_entera_logs" "volume_logs.tar.gz"
restore_volume "entera-pdf_entera_uploads" "volume_uploads.tar.gz"
restore_volume "entera-pdf_entera_pipeline" "volume_pipeline.tar.gz"

if [[ "${AUTH_STACK}" -eq 1 ]]; then
  echo "[3/6] Auth volume'ları..."
  restore_volume "entera-pdf_securipdf_postgres" "volume_keycloak_postgres.tar.gz"
  restore_volume "entera-pdf_securipdf_vault_data" "volume_vault_data.tar.gz"
else
  echo "[3/6] Auth volume'ları atlandı"
fi

echo "[4/6] Servisler yeniden başlatılıyor..."
cd "${DOCKER_DIR}"
docker compose down
if [[ "${AUTH_STACK}" -eq 1 ]]; then
  docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d
else
  docker compose up -d
fi

echo "[5/6] Healthcheck bekleniyor..."
sleep 15
"${SCRIPT_DIR}/healthcheck.sh" || true

if [[ "${AUTH_STACK}" -eq 1 ]] && [[ -f "${DOCKER_DIR}/bootstrap-keycloak-realm.ps1" ]]; then
  echo "[6/6] Keycloak bootstrap (opsiyonel)..."
  if command -v powershell.exe &>/dev/null; then
    powershell.exe -NoProfile -File "${DOCKER_DIR}/bootstrap-keycloak-realm.ps1" 2>/dev/null || \
      echo "  Uyarı: bootstrap atlandı."
  fi
else
  echo "[6/6] Bootstrap atlandı"
fi

echo ""
echo "Geri yükleme tamamlandı."
