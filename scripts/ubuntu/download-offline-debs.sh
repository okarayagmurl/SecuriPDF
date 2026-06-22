#!/usr/bin/env bash
# SecuriPDF — Ubuntu .deb paketlerini indirir (build makinesi, internet VAR)
# Cikti: offline/debs/ ve offline/debs-pwsh/
#
# Kullanim:
#   sudo ./scripts/ubuntu/download-offline-debs.sh
#   ./scripts/build-offline-bundle.sh   # offline/debs pakete dahil edilir
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Root gerekli: sudo $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEBS_DIR="${ROOT_DIR}/offline/debs"
PWSH_DIR="${ROOT_DIR}/offline/debs-pwsh"

export DEBIAN_FRONTEND=noninteractive
mkdir -p "${DEBS_DIR}" "${PWSH_DIR}"

echo "=== Docker .deb indiriliyor ==="
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg lsb-release

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -qq
cd "${DEBS_DIR}"
apt-get download docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  $(apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks \
    --no-replaces --no-enhances docker-ce docker-compose-plugin 2>/dev/null | grep '^\w' | sort -u) \
  2>/dev/null || apt-get download docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo ""
echo "=== PowerShell .deb (opsiyonel) ==="
if apt-cache show powershell &>/dev/null; then
  cd "${PWSH_DIR}"
  apt-get download powershell 2>/dev/null || echo "powershell paketi atlandi"
else
  echo "Microsoft PowerShell repo eklenmemis — Keycloak bootstrap icin pwsh ayri paketlenmeli."
fi

echo ""
echo "Tamam."
echo "  Docker deb: ${DEBS_DIR} ($(find "${DEBS_DIR}" -name '*.deb' | wc -l) dosya)"
echo "  pwsh deb:   ${PWSH_DIR}"
