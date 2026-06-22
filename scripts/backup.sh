#!/usr/bin/env bash
# Entera PDF - Yedekleme scripti
# config, uploads, logs ve docker volume'larını yedekler.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"
BACKUP_ROOT="${ROOT_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "${BACKUP_DIR}"

echo "=== Entera PDF Yedekleme ==="
echo "Hedef: ${BACKUP_DIR}"

# Config dosyaları
echo "[1/5] Config yedekleniyor..."
tar -czf "${BACKUP_DIR}/config.tar.gz" -C "${ROOT_DIR}" config branding VERSION 2>/dev/null || true

# Docker compose env
if [[ -f "${DOCKER_DIR}/.env" ]]; then
  cp "${DOCKER_DIR}/.env" "${BACKUP_DIR}/.env"
fi

# Named volume yedekleme
backup_volume() {
  local vol_name="$1"
  local archive_name="$2"
  if docker volume inspect "${vol_name}" &>/dev/null; then
    echo "  Volume: ${vol_name}"
    docker run --rm \
      -v "${vol_name}:/data:ro" \
      -v "${BACKUP_DIR}:/backup" \
      alpine tar -czf "/backup/${archive_name}" -C /data .
  else
    echo "  Uyarı: Volume ${vol_name} bulunamadı, atlanıyor."
  fi
}

echo "[2/5] Config volume..."
backup_volume "entera-pdf_entera_config" "volume_config.tar.gz"

echo "[3/5] Data volume (OCR/tessdata)..."
backup_volume "entera-pdf_entera_data" "volume_data.tar.gz"

echo "[4/5] Logs volume..."
backup_volume "entera-pdf_entera_logs" "volume_logs.tar.gz"

echo "[5/7] Uploads volume..."
backup_volume "entera-pdf_entera_uploads" "volume_uploads.tar.gz"

echo "[6/7] Keycloak Postgres..."
backup_volume "entera-pdf_securipdf_postgres" "volume_keycloak_postgres.tar.gz"

echo "[7/7] Vault data..."
backup_volume "entera-pdf_securipdf_vault_data" "volume_vault_data.tar.gz"

# Pipeline volume
backup_volume "entera-pdf_entera_pipeline" "volume_pipeline.tar.gz"

# Keycloak realm export (auth stack aktifse)
if docker ps --format '{{.Names}}' | grep -q 'securipdf-keycloak'; then
  echo "[8/8] Keycloak realm export..."
  if command -v powershell.exe &>/dev/null; then
    powershell.exe -NoProfile -File "${DOCKER_DIR}/backup-keycloak.ps1" "${BACKUP_DIR}" 2>/dev/null || \
      echo "  Uyarı: Keycloak export atlandı."
  else
    echo "  Uyarı: powershell.exe yok — Keycloak export atlandı."
  fi
else
  echo "[8/8] Keycloak export atlandı (container yok)."
fi

# Image tag kaydı
cd "${DOCKER_DIR}"
docker compose images 2>/dev/null > "${BACKUP_DIR}/images.txt" || true

echo "${TIMESTAMP}" > "${BACKUP_DIR}/backup.meta"
echo "IMAGE_TAG=${IMAGE_TAG:-unknown}" >> "${BACKUP_DIR}/backup.meta"

# Eski yedekleri temizle
if [[ -d "${BACKUP_ROOT}" ]]; then
  find "${BACKUP_ROOT}" -maxdepth 1 -type d -name "20*" -mtime +"${RETENTION_DAYS}" -exec rm -rf {} + 2>/dev/null || true
fi

echo ""
echo "Yedekleme tamamlandı: ${BACKUP_DIR}"
du -sh "${BACKUP_DIR}" 2>/dev/null || true
