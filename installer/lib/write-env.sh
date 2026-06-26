#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

write_env() {
  local host="${INSTALLER_HOST}"
  local scheme="${INSTALLER_SCHEME}"
  local http_port="${INSTALLER_HTTP_PORT}"
  local kc_port="${INSTALLER_KEYCLOAK_PORT}"
  local puid pgid
  puid="$(id -u)"
  pgid="$(id -g)"

  local app_url base_url kc_public
  if [[ "${INSTALLER_PROD}" == "1" ]]; then
    app_url="${scheme}://${host}"
    base_url="${app_url}"
    kc_public="${scheme}://${host}"
  else
    app_url="${scheme}://${host}:${http_port}"
    base_url="${app_url}"
    kc_public="${scheme}://${host}:${kc_port}"
  fi

  local oauth_secret cookie_secret vault_key kc_admin kc_db
  oauth_secret="$(rand_hex 16)"
  cookie_secret="$(rand_hex 16)"
  vault_key="$(rand_base64 24)"
  kc_admin="$(rand_base64 16)"
  kc_db="$(rand_base64 16)"

  mkdir -p "${DOCKER_DIR}"
  cat > "${ENV_FILE}" <<EOF
# SecuriPDF — installer tarafindan olusturuldu ($(date -Iseconds))
# LDAP: Admin panel > Active Directory > Kaydet > Keycloak'a uygula

ENTERA_VERSION=1.1.0
STIRLING_VERSION=2.13.1
IMAGE_TAG=1.1.0-stirling-2.13.1
STIRLING_IMAGE=docker.stirlingpdf.com/stirlingtools/stirling-pdf

HTTP_PORT=${http_port}
HTTPS_PORT=${INSTALLER_HTTPS_PORT}
STIRLING_INTERNAL_PORT=8080
STIRLING_MEMORY_LIMIT=4G

PUID=${puid}
PGID=${pgid}

PUBLIC_SERVER_IP=${host}
PUBLIC_FQDN=${host}
KEYCLOAK_PUBLIC_FQDN=${host}
PUBLIC_USE_HTTPS=$([[ "${INSTALLER_PROD}" == "1" ]] && echo true || echo false)

UI_APPNAME=SecuriPDF
UI_HOMEDESCRIPTION=Kurumsal PDF islem platformu
UI_APPNAMENAVBAR=SecuriPDF
SYSTEM_DEFAULTLOCALE=tr-TR
LANGS=tr_TR,en_GB

DOCKER_ENABLE_SECURITY=false
SECURITY_ENABLELOGIN=false

# --- LDAP (bos — Admin panelden yapilandirin) ---
LDAP_HOST=
LDAP_URL=
LDAP_BASE_DN=
LDAP_USERS_DN=
LDAP_GROUPS_DN=
LDAP_BIND_DN=
LDAP_BIND_PASSWORD=
LDAP_GROUP_USER=SecuriPDF-Users
LDAP_GROUP_ADMIN=SecuriPDF-Admins
LDAP_GROUP_FILTER=(cn=SecuriPDF-*)

KEYCLOAK_HTTP_PORT=${kc_port}
KEYCLOAK_HOSTNAME=${host}
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=${kc_admin}
KEYCLOAK_DB_PASSWORD=${kc_db}
KEYCLOAK_PROXY=edge

OAUTH2_CLIENT_ID=securipdf
OAUTH2_CLIENT_SECRET=${oauth_secret}
OAUTH2_ISSUER_URL=${kc_public}/realms/securipdf
OAUTH2_REDIRECT_URL=${app_url}/oauth2/callback
OAUTH2_LOGIN_URL=${kc_public}/realms/securipdf/protocol/openid-connect/auth?ui_locales=tr
OAUTH2_SIGN_OUT_REDIRECT_URL=${kc_public}/realms/securipdf/protocol/openid-connect/logout?client_id=securipdf&post_logout_redirect_uri=${app_url}/
OAUTH2_COOKIE_SECRET=${cookie_secret}
OAUTH2_COOKIE_EXPIRE=30m
OAUTH2_GROUPS_CLAIM=realm_access.roles
OAUTH2_OIDC_AUDIENCE_CLAIM=azp
OAUTH2_INSECURE_ISSUER=${INSTALLER_INSECURE_ISSUER}
OAUTH2_SKIP_DISCOVERY=$([[ "${INSTALLER_INSECURE_ISSUER}" == "true" ]] && echo true || echo false)
OAUTH2_ALLOW_UNVERIFIED_EMAIL=true
OAUTH2_INSECURE_TLS=$([[ "${INSTALLER_PROD}" == "1" ]] && echo false || echo true)
OAUTH2_COOKIE_SECURE=${INSTALLER_COOKIE_SECURE}

VAULT_MASTER_KEY=${vault_key}
BREAK_GLASS_PASSWORD=${INSTALLER_BREAK_GLASS}

SYSTEM_MAXFILESIZE=500
SYSTEM_ENABLEANALYTICS=false
SYSTEM_GOOGLEVISIBILITY=false
METRICS_ENABLED=false
SHOW_SURVEY=false

CLIENT_MAX_BODY_SIZE=500M
PROXY_READ_TIMEOUT=3600
PROXY_SEND_TIMEOUT=3600
BACKUP_RETENTION_DAYS=30

SMTP_ENABLED=false
EOF

  chmod 600 "${ENV_FILE}"
  if [[ -n "${SUDO_USER:-}" ]] && [[ "$(id -u)" -eq 0 ]]; then
    chown "${SUDO_USER}:${SUDO_USER}" "${ENV_FILE}"
  fi

  local cred_file="${INSTALLER_DIR}/CREDENTIALS-$(date +%Y%m%d-%H%M%S).txt"
  cat > "${cred_file}" <<EOF
SecuriPDF kurulum bilgileri — guvenli saklayin, kurulumdan sonra silin.
Olusturulma: $(date -Iseconds)

Uygulama URL:     ${app_url}
Admin panel:      ${app_url}/admin
Keycloak:         ${kc_public}

Ilk giris (break-glass):
  Kullanici: securipdf-local-admin
  Parola:    ${INSTALLER_BREAK_GLASS}

Keycloak yonetici (acil durum):
  Kullanici: admin
  Parola:    ${kc_admin}

LDAP: Admin panel > Active Directory bolumunden yapilandirin.
EOF
  chmod 600 "${cred_file}"
  if [[ -n "${SUDO_USER:-}" ]] && [[ "$(id -u)" -eq 0 ]]; then
    chown "${SUDO_USER}:${SUDO_USER}" "${cred_file}"
  fi

  INSTALLER_CRED_FILE="${cred_file}"
  INSTALLER_APP_URL="${app_url}"
  export INSTALLER_CRED_FILE INSTALLER_APP_URL
  log ".env yazildi: ${ENV_FILE}"
  log "Kimlik bilgileri: ${cred_file}"
}
