#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

preflight() {
  log "On kontroller..."

  command -v docker &>/dev/null || die "Docker kurulu degil"
  docker compose version &>/dev/null || die "Docker Compose plugin gerekli"

  if ! docker info &>/dev/null; then
    die "Docker daemon calismiyor veya yetki yok (docker grubu?)"
  fi

  local avail_kb
  avail_kb="$(df -k "${ROOT_DIR}" | awk 'NR==2 {print $4}')"
  if [[ "${avail_kb}" -lt 20971520 ]]; then
    warn "Disk alani 20 GB altinda gorunuyor — OCR image buyuk olabilir"
  fi

  log "On kontroller tamam"
}
