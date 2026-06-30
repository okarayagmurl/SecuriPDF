#!/usr/bin/env bash
# Logout duzeltmesini mevcut kuruluma uygular (repo + offline dizin gerekli).
# Kullanim:
#   cd ~/SecuriPDF && git pull
#   bash scripts/patch-logout-deploy.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OFFLINE_DIR="${SECURIPDF_OFFLINE_DIR:-${HOME}/securipdf-1.1.0-stirling-2.13.1-offline}"

echo "=== Logout patch deploy ==="
echo "Repo:    ${REPO_DIR}"
echo "Offline: ${OFFLINE_DIR}"

[[ -d "${OFFLINE_DIR}/docker" ]] || { echo "HATA: offline dizin yok: ${OFFLINE_DIR}" >&2; exit 1; }
[[ -f "${OFFLINE_DIR}/docker/.env" ]] || { echo "HATA: ${OFFLINE_DIR}/docker/.env yok" >&2; exit 1; }

# shellcheck disable=SC1091
source "${OFFLINE_DIR}/docker/load-env.sh"
load_dotenv "${OFFLINE_DIR}/docker/.env"
HOST="${PUBLIC_FQDN:-${KEYCLOAK_HOSTNAME:-}}"
[[ -n "${HOST}" && "${HOST}" != "localhost" ]] || { echo "HATA: .env icinde gecerli IP/FQDN yok" >&2; exit 1; }

echo ""
echo "[1/4] Docker compose + script senkronu..."
install -m 0644 "${REPO_DIR}/docker/docker-compose.auth.yml" "${OFFLINE_DIR}/docker/docker-compose.auth.yml"
for f in fix-access-url.sh verify-auth-urls.sh diagnose-logout.sh bootstrap-stack-auth.sh; do
  install -m 0755 "${REPO_DIR}/docker/${f}" "${OFFLINE_DIR}/docker/${f}"
done
install -m 0755 "${REPO_DIR}/scripts/upgrade-offline-stack.sh" "${OFFLINE_DIR}/scripts/upgrade-offline-stack.sh"

echo ""
echo "[2/4] Offline paket build (platform app.js + oauth2 v7.8.2)..."
bash "${REPO_DIR}/scripts/build-offline-bundle.sh"

echo ""
echo "[3/4] Paket offline dizine aciliyor..."
tar xzf "${REPO_DIR}/dist/securipdf-"*-offline.tar.gz -C "${OFFLINE_DIR}" --strip-components=1

echo ""
echo "[4/4] Stack upgrade..."
bash "${OFFLINE_DIR}/scripts/upgrade-offline-stack.sh"

echo ""
bash "${OFFLINE_DIR}/docker/diagnose-logout.sh"
