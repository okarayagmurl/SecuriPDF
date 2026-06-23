#!/usr/bin/env bash
# SecuriPDF — Ubuntu on gereksinimleri (KAPALI AG)
# Docker .deb paketleri paketin offline/debs/ klasorunde olmali.
#
# Build makinesinde (internet var):
#   ./scripts/ubuntu/download-offline-debs.sh
#
# Musteri sunucusunda:
#   sudo ./scripts/ubuntu/install-prerequisites-offline.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Root gerekli: sudo $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEBS_DIR="${OFFLINE_DEBS_DIR:-${ROOT_DIR}/offline/debs}"

export DEBIAN_FRONTEND=noninteractive

echo "=== SecuriPDF — Offline on gereksinimler ==="

if [[ -d "${DEBS_DIR}" ]] && ls "${DEBS_DIR}"/*.deb &>/dev/null; then
  echo "Yerel Docker .deb paketleri kuruluyor: ${DEBS_DIR}"
  apt-get install -y -qq "${DEBS_DIR}"/*.deb || {
    dpkg -i "${DEBS_DIR}"/*.deb || true
    apt-get -f install -y -q
  }
else
  echo "UYARI: ${DEBS_DIR} bos veya yok." >&2
  if command -v docker &>/dev/null; then
    echo "Mevcut Docker kullanilacak: $(docker --version)"
  else
    echo "Docker kurulu degil. Once download-offline-debs.sh ile paket hazirlayin." >&2
    exit 1
  fi
fi

# PowerShell offline (opsiyonel)
PWSH_DEBS="${ROOT_DIR}/offline/debs-pwsh"
if [[ -d "${PWSH_DEBS}" ]] && ls "${PWSH_DEBS}"/*.deb &>/dev/null; then
  echo "PowerShell (pwsh) kuruluyor: ${PWSH_DEBS}"
  apt-get install -y -qq "${PWSH_DEBS}"/*.deb || {
    dpkg -i "${PWSH_DEBS}"/*.deb || true
    apt-get -f install -y -q
  }
else
  echo "UYARI: offline/debs-pwsh bos — Keycloak bootstrap icin pwsh gerekir." >&2
fi

systemctl enable docker 2>/dev/null || true
systemctl start docker 2>/dev/null || true

DEPLOY_USER="${SUDO_USER:-${USER}}"
if id "${DEPLOY_USER}" &>/dev/null; then
  usermod -aG docker "${DEPLOY_USER}" || true
fi

docker --version
docker compose version
echo "Tamam."
