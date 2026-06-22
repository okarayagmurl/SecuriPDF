#!/usr/bin/env bash
# tools.yml whitelist'inden settings.yml endpoints.toRemove listesini üretir.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v python3 &>/dev/null; then
  exec python3 "${SCRIPT_DIR}/sync-tools-config.py" "$@"
elif command -v python &>/dev/null; then
  exec python "${SCRIPT_DIR}/sync-tools-config.py" "$@"
else
  echo "Hata: python3 veya python gerekli." >&2
  exit 1
fi
