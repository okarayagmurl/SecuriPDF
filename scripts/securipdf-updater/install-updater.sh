#!/usr/bin/env bash
# SecuriPDF host updater agent — systemd kurulumu
#
# Kullanim:
#   sudo SECURIPDF_OFFLINE_DIR=/home/spfadm/securipdf-*-offline \
#        SECURIPDF_UPDATER_TOKEN=... \
#        bash scripts/securipdf-updater/install-updater.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

OFFLINE_DIR="${SECURIPDF_OFFLINE_DIR:-${REPO_ROOT}}"
TOKEN="${SECURIPDF_UPDATER_TOKEN:-}"
PORT="${SECURIPDF_UPDATER_PORT:-8765}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "HATA: root gerekli (sudo)" >&2
  exit 1
fi

if [[ -z "${TOKEN}" && -f "${OFFLINE_DIR}/docker/.env" ]]; then
  # shellcheck disable=SC1091
  source "${OFFLINE_DIR}/docker/load-env.sh"
  load_dotenv "${OFFLINE_DIR}/docker/.env"
  TOKEN="${SECURIPDF_UPDATER_TOKEN:-}"
fi

if [[ -z "${TOKEN}" ]]; then
  if command -v openssl &>/dev/null; then
    TOKEN="$(openssl rand -hex 16)"
  else
    TOKEN="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  echo "UYARI: SECURIPDF_UPDATER_TOKEN uretildi — docker/.env ile eslestirin." >&2
fi

mkdir -p /etc/securipdf /var/lib/securipdf/jobs
install -m 0755 "${SCRIPT_DIR}/updater.py" /usr/local/bin/securipdf-updater.py

cat > /etc/securipdf/updater.env <<EOF
SECURIPDF_OFFLINE_DIR=${OFFLINE_DIR}
SECURIPDF_UPDATER_TOKEN=${TOKEN}
SECURIPDF_UPDATER_PORT=${PORT}
SECURIPDF_UPDATER_HOST=127.0.0.1
EOF
chmod 600 /etc/securipdf/updater.env

cat > /etc/systemd/system/securipdf-updater.service <<'UNIT'
[Unit]
Description=SecuriPDF host upgrade agent
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
EnvironmentFile=/etc/securipdf/updater.env
ExecStart=/usr/bin/python3 /usr/local/bin/securipdf-updater.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable securipdf-updater.service
systemctl restart securipdf-updater.service

if systemctl is-active --quiet securipdf-updater.service; then
  echo "OK: securipdf-updater calisiyor (${PORT})"
else
  echo "HATA: securipdf-updater baslamadi" >&2
  journalctl -u securipdf-updater -n 20 --no-pager >&2 || true
  exit 1
fi

# docker/.env senkronu (platform container icin)
ENV_FILE="${OFFLINE_DIR}/docker/.env"
if [[ -f "${ENV_FILE}" ]]; then
  set_env() {
    local key="$1" val="$2" tmp="${ENV_FILE}.tmp.$$"
    if grep -q "^${key}=" "${ENV_FILE}"; then
      grep -v "^${key}=" "${ENV_FILE}" > "${tmp}"
      printf '%s=%s\n' "${key}" "${val}" >> "${tmp}"
      mv "${tmp}" "${ENV_FILE}"
    else
      printf '%s=%s\n' "${key}" "${val}" >> "${ENV_FILE}"
    fi
    rm -f "${tmp}" 2>/dev/null || true
  }
  set_env SECURIPDF_UPDATER_TOKEN "${TOKEN}"
  set_env SECURIPDF_UPDATER_URL "http://host.docker.internal:${PORT}"
  echo "docker/.env guncellendi: SECURIPDF_UPDATER_*"
fi

echo "Offline dizin: ${OFFLINE_DIR}"
