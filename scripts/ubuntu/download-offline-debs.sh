#!/usr/bin/env bash
# SecuriPDF — Ubuntu .deb paketlerini indirir (build makinesi, internet VAR)
# Cikti: offline/debs/ ve offline/debs-pwsh/
#
# Kullanim:
#   sudo bash scripts/ubuntu/download-offline-debs.sh
#   ./scripts/build-offline-bundle.sh
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

ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
VERSION_ID="$(. /etc/os-release && echo "${VERSION_ID}")"

echo "=== Docker .deb indiriliyor ==="
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg lsb-release wget

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

if [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
fi

cd "${DEBS_DIR}"
apt-get download docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  $(apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks \
    --no-replaces --no-enhances docker-ce docker-compose-plugin 2>/dev/null | grep '^\w' | sort -u) \
  2>/dev/null || apt-get download docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

download_pwsh_via_apt() {
  local ms_prod="/tmp/packages-microsoft-prod.deb"
  rm -f "${ms_prod}"
  wget -q "https://packages.microsoft.com/config/ubuntu/${VERSION_ID}/packages-microsoft-prod.deb" -O "${ms_prod}"
  if ! file "${ms_prod}" | grep -q 'Debian binary package'; then
    echo "  HATA: packages-microsoft-prod.deb gecersiz (URL: ubuntu/${VERSION_ID})" >&2
    return 1
  fi
  dpkg -i "${ms_prod}"
  apt-get update -qq
  if ! apt-cache show powershell &>/dev/null; then
    echo "  HATA: apt powershell paketi bulunamadi (${CODENAME} / ${VERSION_ID})" >&2
    return 1
  fi
  cd "${PWSH_DIR}"
  apt-get install --download-only -y powershell
  find /var/cache/apt/archives -maxdepth 1 -name '*.deb' -exec cp -f {} "${PWSH_DIR}/" \;
  return 0
}

download_pwsh_via_github() {
  # Microsoft Learn universal .deb (apt repo basarisiz olursa)
  local version="${PWSH_VERSION:-7.5.2}"
  local deb="powershell_${version}-1.deb_amd64.deb"
  local url="https://github.com/PowerShell/PowerShell/releases/download/v${version}/${deb}"
  cd "${PWSH_DIR}"
  rm -f "${deb}"
  wget -q -O "${deb}" "${url}" || return 1
  if ! file "${deb}" | grep -q 'Debian binary package'; then
    echo "  HATA: GitHub pwsh deb gecersiz: ${url}" >&2
    return 1
  fi
  # Bagimliliklari indir (kurulum yapmadan)
  apt-get install -y -qq --download-only "./${deb}" 2>/dev/null || true
  find /var/cache/apt/archives -maxdepth 1 -name '*.deb' -newer "${deb}" -exec cp -fn {} "${PWSH_DIR}/" \; 2>/dev/null || true
  # Eksik bagimliliklar icin dpkg-deb Depends satirini coz
  local depends
  depends="$(dpkg-deb -f "${deb}" Depends 2>/dev/null || true)"
  if [[ -n "${depends}" ]]; then
    apt-get download $(echo "${depends}" | sed 's/|.*//g; s/(.*)//g; s/,//g' | tr ' ' '\n' | grep -v '^$' | sort -u) 2>/dev/null || true
  fi
  return 0
}

echo ""
echo "=== PowerShell .deb (Keycloak bootstrap) ==="
PWSH_OK=0
if download_pwsh_via_apt; then
  echo "  APT ile indirildi."
  PWSH_OK=1
else
  echo "  APT basarisiz — GitHub universal .deb deneniyor..."
  if download_pwsh_via_github; then
    echo "  GitHub .deb ile indirildi."
    PWSH_OK=1
  fi
fi

PWSH_COUNT=$(find "${PWSH_DIR}" -name '*.deb' 2>/dev/null | wc -l)
if [[ "${PWSH_OK}" -eq 0 || "${PWSH_COUNT}" -eq 0 ]]; then
  echo "  HATA: PowerShell deb indirilemedi." >&2
  exit 1
fi

echo ""
echo "=== Ozet ==="
echo "  Build makinesi: Ubuntu ${VERSION_ID} (${CODENAME}, ${ARCH})"
echo "  Musteri sunucusu AYNI major surum olmali (${VERSION_ID})."
echo "  Docker deb: ${DEBS_DIR} ($(find "${DEBS_DIR}" -name '*.deb' 2>/dev/null | wc -l) dosya)"
echo "  pwsh deb:   ${PWSH_DIR} (${PWSH_COUNT} dosya)"
echo ""
echo "Sonraki adimlar (build makinesi):"
echo "  sudo bash scripts/ubuntu/install-prerequisites-offline.sh   # Docker + pwsh KUR"
echo "  ./scripts/build-offline-bundle.sh"
