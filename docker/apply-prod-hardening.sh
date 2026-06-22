#!/usr/bin/env bash
# SecuriPDF — Prod sertlestirme profili (Ubuntu/Linux)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

FORCE=0
for arg in "$@"; do
  [[ "${arg}" == "--force" || "${arg}" == "-f" ]] && FORCE=1
done

echo "SecuriPDF prod sertlestirme profili"
if [[ "${FORCE}" -eq 0 ]]; then
  echo "UYARI: ip-whitelist.prod.conf localhost disindaki erisimi kisitlar."
  read -r -p "Devam? (evet/hayir): " confirm
  [[ "${confirm}" =~ ^(evet|e|yes|y)$ ]] || exit 0
fi

cp -f nginx/ip-whitelist.prod.conf nginx/ip-whitelist.conf
echo "[OK] ip-whitelist.prod.conf uygulandi"

"${SCRIPT_DIR}/generate-tls.sh"

ENV_FILE="${SCRIPT_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  cp .env.prod.example "${ENV_FILE}" 2>/dev/null || cp .env.example "${ENV_FILE}"
  echo "UYARI: .env olusturuldu — sifreleri doldurun"
fi

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
  else
    echo "${key}=${value}" >> "${ENV_FILE}"
  fi
}

set_env OAUTH2_INSECURE_ISSUER false
set_env OAUTH2_SKIP_DISCOVERY false
set_env OAUTH2_ALLOW_UNVERIFIED_EMAIL false
set_env OAUTH2_INSECURE_TLS false
set_env OAUTH2_COOKIE_SECURE true
echo "[OK] .env oauth2 sertlestirme bayraklari guncellendi"

echo ""
echo "Sonraki adimlar:"
echo "  1. .env: VAULT_MASTER_KEY, KEYCLOAK_* parolalarini guncelleyin"
echo "  2. .env: OAUTH2_REDIRECT_URL=https://<hostname>/oauth2/callback"
echo "  3. ./deploy-prod.sh --force"
