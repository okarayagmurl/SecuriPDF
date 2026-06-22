#!/usr/bin/env bash
# SecuriPDF — Ubuntu sunucu ön gereksinimleri (Docker, Compose, yardımcı araçlar)
# Kullanım: sudo ./scripts/ubuntu/install-prerequisites.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Bu script root olarak calistirilmali: sudo $0" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
APT="apt-get -y -q"

echo "=== SecuriPDF — Ubuntu on gereksinimleri ==="

# Temel paketler
$APT update
$APT install ca-certificates curl gnupg lsb-release git python3 python3-pip \
  wget unzip jq openssl apache2-utils

# Docker resmi repo (https://docs.docker.com/engine/install/ubuntu/)
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

$APT update
$APT install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker

# Kurulum kullanicisini docker grubuna ekle (sudo olmadan docker)
DEPLOY_USER="${SUDO_USER:-${USER}}"
if id "${DEPLOY_USER}" &>/dev/null; then
  usermod -aG docker "${DEPLOY_USER}" || true
  echo "Kullanici '${DEPLOY_USER}' docker grubuna eklendi (oturumu kapatip acin)."
fi

# Opsiyonel: PowerShell (mevcut .ps1 bootstrap scriptleri icin)
INSTALL_PWSH="${INSTALL_PWSH:-0}"
if [[ "${INSTALL_PWSH}" == "1" ]]; then
  if ! command -v pwsh &>/dev/null; then
    $APT install powershell || {
      echo "PowerShell paketi bulunamadi — Microsoft repo: https://learn.microsoft.com/powershell/scripting/install/install-ubuntu"
    }
  fi
fi

echo ""
echo "=== Dogrulama ==="
docker --version
docker compose version
python3 --version

echo ""
echo "Tamam. Sonraki adim:"
echo "  git clone <repo-url> SecuriPDF && cd SecuriPDF"
echo "  cp docker/.env.ubuntu.example docker/.env"
echo "  ./scripts/sync-tools-config.sh"
echo "  cd docker && ./up-auth.sh"
