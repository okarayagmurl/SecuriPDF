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
    # shellcheck disable=SC1091
    source "${DOCKER_DIR}/load-env.sh"
    load_dotenv "${ENV_FILE}"
  fi
  ensure_pwsh
  pwsh -NoProfile -File "${DOCKER_DIR}/${script}" "$@"
}

ensure_pwsh() {
  if command -v pwsh &>/dev/null; then
    return 0
  fi
  local pwsh_debs=""
  for candidate in \
    "${ROOT_DIR}/offline/debs-pwsh" \
    "${INSTALLER_DIR}/../offline/debs-pwsh"; do
    if [[ -d "${candidate}" ]] && compgen -G "${candidate}/powershell_*.deb" >/dev/null; then
      pwsh_debs="${candidate}"
      break
    fi
  done
  if [[ -z "${pwsh_debs}" ]]; then
    die "pwsh gerekli (Keycloak bootstrap). offline/debs-pwsh icinde powershell_*.deb yok — once prerequisites veya: sudo dpkg -i offline/debs-pwsh/powershell_*.deb"
  fi
  log "pwsh bulunamadi — offline deb kuruluyor: ${pwsh_debs}"
  local apt_cmd=()
  if [[ "${EUID}" -eq 0 ]]; then
    apt_cmd=(dpkg)
  else
    apt_cmd=(sudo dpkg)
  fi
  # Yalniz powershell_*.deb — docker debs ile karismasin
  if ! "${apt_cmd[@]}" -i "${pwsh_debs}"/powershell_*.deb; then
    if [[ "${EUID}" -eq 0 ]]; then
      apt-get -f install -y -q || true
      dpkg -i "${pwsh_debs}"/powershell_*.deb
    else
      sudo apt-get -f install -y -q || true
      sudo dpkg -i "${pwsh_debs}"/powershell_*.deb
    fi
  fi
  command -v pwsh &>/dev/null || die "pwsh kurulamadi (${pwsh_debs})"
  log "pwsh hazir: $(command -v pwsh)"
}

bootstrap_keycloak() {
  ensure_pwsh
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
