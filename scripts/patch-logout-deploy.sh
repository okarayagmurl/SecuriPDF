#!/usr/bin/env bash
# Logout duzeltmesini mevcut kuruluma uygular (repo + offline dizin gerekli).
#
# Kullanim:
#   cd ~/SecuriPDF && git pull
#   sudo bash scripts/patch-logout-deploy.sh
#
# sudo ile calisirken offline dizin otomatik bulunur (SUDO_USER home).
# Elle: SECURIPDF_OFFLINE_DIR=/home/spfadm/securipdf-*-offline sudo bash scripts/patch-logout-deploy.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

securipdf_user_home() {
  if [[ -n "${SUDO_USER:-}" && "$(id -u)" -eq 0 ]]; then
    getent passwd "${SUDO_USER}" | cut -d: -f6
  else
    echo "${HOME}"
  fi
}

resolve_offline_dir() {
  if [[ -n "${SECURIPDF_OFFLINE_DIR:-}" ]]; then
    echo "${SECURIPDF_OFFLINE_DIR}"
    return
  fi
  local base candidate
  base="$(securipdf_user_home)"
  for candidate in \
    "${base}/securipdf-1.1.0-stirling-2.13.1-offline" \
    "${base}"/securipdf-*-offline; do
    [[ -d "${candidate}/docker" && -f "${candidate}/docker/.env" ]] || continue
    echo "${candidate}"
    return
  done
  echo "${base}/securipdf-1.1.0-stirling-2.13.1-offline"
}

OFFLINE_DIR="$(resolve_offline_dir)"
OFFLINE_OWNER="${SUDO_USER:-$(stat -c '%U' "${OFFLINE_DIR}" 2>/dev/null || echo root)}"

echo "=== Logout patch deploy ==="
echo "Repo:    ${REPO_DIR}"
echo "Offline: ${OFFLINE_DIR}"

[[ -d "${OFFLINE_DIR}/docker" ]] || {
  echo "HATA: offline dizin yok: ${OFFLINE_DIR}" >&2
  echo "  SECURIPDF_OFFLINE_DIR=/home/spfadm/securipdf-*-offline ile tekrar deneyin." >&2
  exit 1
}
[[ -f "${OFFLINE_DIR}/docker/.env" ]] || {
  echo "HATA: ${OFFLINE_DIR}/docker/.env yok" >&2
  exit 1
}

# shellcheck disable=SC1091
source "${OFFLINE_DIR}/docker/load-env.sh"
load_dotenv "${OFFLINE_DIR}/docker/.env"
HOST="${PUBLIC_FQDN:-${KEYCLOAK_HOSTNAME:-}}"
[[ -n "${HOST}" && "${HOST}" != "localhost" ]] || {
  echo "HATA: .env icinde gecerli IP/FQDN yok" >&2
  exit 1
}

install_as_owner() {
  local mode="$1" src="$2" dst="$3"
  install -m "${mode}" "${src}" "${dst}"
  if [[ "$(id -u)" -eq 0 && -n "${SUDO_USER:-}" ]]; then
    chown "${SUDO_USER}:${SUDO_USER}" "${dst}"
  fi
}

echo ""
echo "[1/4] Docker compose + script senkronu..."
install_as_owner 0644 "${REPO_DIR}/docker/docker-compose.auth.yml" "${OFFLINE_DIR}/docker/docker-compose.auth.yml"
for f in fix-access-url.sh verify-auth-urls.sh diagnose-logout.sh bootstrap-stack-auth.sh; do
  install_as_owner 0755 "${REPO_DIR}/docker/${f}" "${OFFLINE_DIR}/docker/${f}"
done
mkdir -p "${OFFLINE_DIR}/scripts"
install_as_owner 0755 "${REPO_DIR}/scripts/upgrade-offline-stack.sh" "${OFFLINE_DIR}/scripts/upgrade-offline-stack.sh"

echo ""
echo "[2/4] Offline paket build (platform app.js + oauth2 v7.8.2)..."
if [[ "$(id -u)" -eq 0 && -n "${SUDO_USER:-}" ]]; then
  sudo -u "${SUDO_USER}" bash "${REPO_DIR}/scripts/build-offline-bundle.sh"
else
  bash "${REPO_DIR}/scripts/build-offline-bundle.sh"
fi

echo ""
echo "[3/4] Paket offline dizine aciliyor..."
tar xzf "${REPO_DIR}/dist/securipdf-"*-offline.tar.gz -C "${OFFLINE_DIR}" --strip-components=1
if [[ "$(id -u)" -eq 0 && -n "${SUDO_USER:-}" ]]; then
  chown -R "${SUDO_USER}:${SUDO_USER}" "${OFFLINE_DIR}"
fi

echo ""
echo "[4/4] Stack upgrade..."
bash "${OFFLINE_DIR}/scripts/upgrade-offline-stack.sh"

echo ""
bash "${OFFLINE_DIR}/docker/diagnose-logout.sh"
