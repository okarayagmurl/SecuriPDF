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
echo "=== PowerShell .deb (Keycloak bootstrap icin onerilir) ==="
PWSH_DEB="${PWSH_DIR}"
mkdir -p "${PWSH_DEB}"
MS_PROD="/tmp/packages-microsoft-prod.deb"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
ARCH="$(dpkg --print-architecture)"

if wget -q "https://packages.microsoft.com/config/ubuntu/${CODENAME}/packages-microsoft-prod.deb" -O "${MS_PROD}"; then
  dpkg -i "${MS_PROD}" 2>/dev/null || true
  apt-get update -qq
  if apt-cache show powershell &>/dev/null; then
    cd "${PWSH_DEB}"
    PWSH_PKGS=(powershell)
    while IFS= read -r dep; do
      [[ -n "${dep}" ]] && PWSH_PKGS+=("${dep}")
    done < <(apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks \
      --no-replaces --no-enhances powershell 2>/dev/null | grep '^\w' | sort -u)
    apt-get download "${PWSH_PKGS[@]}" 2>/dev/null || apt-get download powershell 2>/dev/null || true
    echo "  PowerShell deb indirildi: $(find "${PWSH_DEB}" -name '*.deb' | wc -l) dosya"
  else
    echo "  UYARI: powershell paketi bu Ubuntu surumunde bulunamadi (${CODENAME})."
  fi
else
  echo "  UYARI: Microsoft repo indirilemedi — pwsh ayri hazirlanmali."
fi

echo ""
echo "=== Ozet ==="
echo "  Build makinesi Ubuntu: ${CODENAME} (${ARCH})"
echo "  Musteri sunucusu AYNI major Ubuntu surumunde olmali (or. 24.04 -> 24.04)."
echo "  Docker deb: ${DEBS_DIR} ($(find "${DEBS_DIR}" -name '*.deb' 2>/dev/null | wc -l) dosya)"
echo "  pwsh deb:   ${PWSH_DEB} ($(find "${PWSH_DEB}" -name '*.deb' 2>/dev/null | wc -l) dosya)"
