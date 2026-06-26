#!/usr/bin/env bash
# SecuriPDF installer — ortak yardimcilar
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER_DIR="${ROOT_DIR}/installer"
DOCKER_DIR="${ROOT_DIR}/docker"
ENV_FILE="${DOCKER_DIR}/.env"

log() { echo "[installer] $*"; }
warn() { echo "[installer] UYARI: $*" >&2; }
die() { echo "[installer] HATA: $*" >&2; exit 1; }

rand_hex() {
  local nbytes="${1:-16}"
  if command -v openssl &>/dev/null; then
    openssl rand -hex "${nbytes}"
  else
    head -c "${nbytes}" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

rand_base64() {
  local nbytes="${1:-24}"
  if command -v openssl &>/dev/null; then
    openssl rand -base64 "${nbytes}" | tr -d '/+=' | head -c 32
  else
    rand_hex 16
  fi
}

prompt_default() {
  local label="$1"
  local default="$2"
  local value
  read -r -p "${label} [${default}]: " value
  echo "${value:-$default}"
}

prompt_yes_no() {
  local label="$1"
  local default="${2:-y}"
  local hint="E/h"
  [[ "${default}" == "n" ]] && hint="e/H"
  local value
  read -r -p "${label} (${hint}): " value
  value="${value:-$default}"
  [[ "${value}" =~ ^[eEyY] ]]
}

run_ps1() {
  local script="$1"
  shift
  if [[ -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${ENV_FILE}"
    set +a
  fi
  if command -v pwsh &>/dev/null; then
    pwsh -NoProfile -File "${DOCKER_DIR}/${script}" "$@"
  else
    die "PowerShell (pwsh) gerekli. Ubuntu: sudo apt install powershell"
  fi
}

bootstrap_keycloak() {
  [[ -x "${DOCKER_DIR}/bootstrap-stack-auth.sh" ]] || die "bootstrap-stack-auth.sh bulunamadi"
  log "Keycloak realm bootstrap (bekleme + dogrulama)..."
  "${DOCKER_DIR}/bootstrap-stack-auth.sh"
}

compose_cmd() {
  local files=(
    -f docker-compose.yml
    -f docker-compose.auth.yml
  )
  if [[ "${INSTALLER_OFFLINE:-0}" == "1" ]]; then
    files+=(-f docker-compose.offline.yml)
  fi
  if [[ "${INSTALLER_PROD:-0}" == "1" ]]; then
    files+=(-f docker-compose.prod.yml)
  fi
  docker compose "${files[@]}" "$@"
}
