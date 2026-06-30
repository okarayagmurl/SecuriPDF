#!/usr/bin/env bash
# Logout / auth kurulumunu hizli dogrular (sunucuda).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTTP_PORT="${HTTP_PORT:-8080}"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/load-env.sh"
  load_dotenv "${SCRIPT_DIR}/.env"
  HTTP_PORT="${HTTP_PORT:-8080}"
fi

echo "=== SecuriPDF logout teshis ==="

if docker ps --format '{{.Names}}' | grep -q securipdf-platform; then
  n="$(docker exec securipdf-platform grep -c redirectToLogin /app/app/static/app/app.js 2>/dev/null || echo 0)"
  if [[ "${n}" -gt 0 ]]; then
    echo "[OK] Platform app.js: redirectToLogin (${n})"
  else
    echo "[FAIL] Platform app.js eski — upgrade-offline-stack.sh calistirin" >&2
  fi
else
  echo "[FAIL] securipdf-platform calismiyor" >&2
fi

ver="$(curl -sf "http://127.0.0.1:${HTTP_PORT}/app/" 2>/dev/null | grep -o 'app.js?v=[0-9]*' | head -1 || true)"
echo "Tarayici script: ${ver:-bulunamadi} (beklenen: app.js?v=57+)"

if docker inspect securipdf-oauth2-proxy &>/dev/null; then
  img="$(docker inspect securipdf-oauth2-proxy --format '{{.Config.Image}}')"
  echo "oauth2-proxy image: ${img}"
  docker inspect securipdf-oauth2-proxy --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep -E '^OAUTH2_PROXY_(BACKEND_LOGOUT|SIGN_OUT_REDIRECT)_URL=' || true
else
  echo "[FAIL] oauth2-proxy yok" >&2
fi

echo ""
echo "Manuel cikis testi: http://127.0.0.1:${HTTP_PORT}/oauth2/sign_out"
