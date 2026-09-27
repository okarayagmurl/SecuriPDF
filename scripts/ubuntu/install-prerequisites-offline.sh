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

# Taban OS kutuphaneleri paketle gelebilir; kurulu sistem daha yeniyse surum dusurme apt'yi kirar.
is_base_os_package() {
  case "$1" in
    libc6|libc6-dev|libc-bin|libc-dev-bin|libsystemd0|systemd|systemd-sysv|libtinfo6|libncurses6|libncursesw6|libgcc-s1|gcc-14-base|libstdc++6)
      return 0
      ;;
  esac
  return 1
}

if [[ -d "${DEBS_DIR}" ]] && ls "${DEBS_DIR}"/*.deb &>/dev/null; then
  echo "Yerel Docker .deb paketleri kuruluyor: ${DEBS_DIR}"
  installable=()
  for deb in "${DEBS_DIR}"/*.deb; do
    [[ -f "${deb}" ]] || continue
    pkg="$(dpkg-deb -f "${deb}" Package)"
    ver="$(dpkg-deb -f "${deb}" Version)"
    if is_base_os_package "${pkg}"; then
      echo "  atlandi (taban OS, surum dusurulmez): ${pkg} ${ver}"
      continue
    fi
    inst="$(dpkg-query -W -f '${Version}' "${pkg}" 2>/dev/null || true)"
    if [[ -n "${inst}" ]] && dpkg --compare-versions "${inst}" ge "${ver}"; then
      echo "  atlandi (kurulu ${inst} >= ${ver}): ${pkg}"
      continue
    fi
    installable+=("${deb}")
  done
  if [[ "${#installable[@]}" -gt 0 ]]; then
    # Surum dusurme yukaridaki filtrede elenir. --no-downgrades, .deb
    # dosyalariyla apt-get'te "not understood" hatasi verir.
    apt-get install -y "${installable[@]}"
  else
    echo "Kurulacak yeni Docker .deb yok."
  fi
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
if [[ -d "${PWSH_DEBS}" ]] && ls "${PWSH_DEBS}"/powershell_*.deb &>/dev/null; then
  echo "PowerShell (pwsh) kuruluyor: ${PWSH_DEBS}"
  # Yalniz powershell_*.deb. apt-get -f kullanma: bozuk libc/systemd deb'lerini geri ceker.
  apt-get install -y "${PWSH_DEBS}"/powershell_*.deb
  command -v pwsh >/dev/null && echo "pwsh: $(command -v pwsh)" || echo "UYARI: pwsh PATH'te yok" >&2
else
  echo "UYARI: offline/debs-pwsh icinde powershell_*.deb yok — Keycloak bootstrap icin pwsh gerekir." >&2
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
