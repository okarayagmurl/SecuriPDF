from __future__ import annotations

import base64
import os
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml

from .crypto_util import decrypt_bytes, encrypt_bytes

if TYPE_CHECKING:
    from .config import Settings


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def get_merged_vault_quotas(data_path: Path, vault_config_path: Path) -> dict[str, Any]:
    base = _load_yaml(vault_config_path)
    quotas = deepcopy(base.get("quotas", {}))
    override = _load_yaml(data_path / "config" / "admin-settings.yml").get("vault", {})
    quotas.update({k: v for k, v in override.items() if k in ("default_max_bytes_per_user", "max_file_bytes")})
    return quotas


class SettingsStore:
    """Admin tarafindan duzenlenebilir ayarlar — /vault-data/config/admin-settings.yml."""

    def __init__(
        self,
        settings: "Settings",
        vault_config_path: Path | None = None,
        license_config_path: Path | None = None,
    ):
        self.settings = settings
        self.security_path = settings.security_config_path
        self.vault_config_path = vault_config_path or Path(os.getenv("VAULT_CONFIG", "/config/vault.yml"))
        self.license_config_path = license_config_path or settings.license_config_path
        self.override_path = settings.data_path / "config" / "admin-settings.yml"

    def _override(self) -> dict[str, Any]:
        return _load_yaml(self.override_path)

    def _save_override(self, data: dict[str, Any]) -> None:
        self.override_path.parent.mkdir(parents=True, exist_ok=True)
        with self.override_path.open("w", encoding="utf-8") as handle:
            yaml.safe_dump(data, handle, allow_unicode=True, default_flow_style=False)

    def merged_ldap(self) -> dict[str, Any]:
        sec = _load_yaml(self.security_path)
        base = sec.get("authentication", {}).get("ldap", {})
        ad = _load_yaml(Path("/config/ad.yml"))
        if ad.get("connection"):
            conn = ad["connection"]
            base = _deep_merge(
                {
                    "host": conn.get("host"),
                    "url": conn.get("url"),
                    "base_dn": conn.get("base_dn"),
                    "users_dn": conn.get("users_dn"),
                    "bind_dn": conn.get("bind_dn"),
                    "groups": ad.get("groups", {}),
                },
                base,
            )
        override = self._override().get("ldap", {})
        merged = _deep_merge(base, override)
        if override.get("groups_dn"):
            merged["groups_dn"] = override["groups_dn"]
        elif not merged.get("groups_dn"):
            merged["groups_dn"] = merged.get("base_dn") or os.getenv("LDAP_GROUPS_DN", "")
        if override.get("group_filter"):
            merged["group_filter"] = override["group_filter"]
        elif not merged.get("group_filter"):
            merged["group_filter"] = os.getenv("LDAP_GROUP_FILTER", "(cn=SecuriPDF-*)")
        # .env operasyonel kaynak — ad.yml'deki varsayilan bind hesabini ezmesin
        for env_key, field in (
            ("LDAP_HOST", "host"),
            ("LDAP_BASE_DN", "base_dn"),
            ("LDAP_USERS_DN", "users_dn"),
            ("LDAP_GROUPS_DN", "groups_dn"),
            ("LDAP_BIND_DN", "bind_dn"),
        ):
            env_val = os.getenv(env_key, "").strip()
            if env_val:
                merged[field] = env_val
        return merged

    def merged_vault(self) -> dict[str, Any]:
        base = _load_yaml(self.vault_config_path)
        quotas = deepcopy(base.get("quotas", {}))
        retention = deepcopy(base.get("retention", {}))
        storage_roots = deepcopy(base.get("storage_roots", {}))
        override = self._override().get("vault", {})
        quotas.update({k: v for k, v in override.items() if k in ("default_max_bytes_per_user", "max_file_bytes")})
        if "soft_delete_days" in override:
            retention["soft_delete_days"] = override["soft_delete_days"]
        if "documents_ttl_value" in override:
            retention["documents_ttl_value"] = override["documents_ttl_value"]
        if "documents_ttl_unit" in override:
            retention["documents_ttl_unit"] = override["documents_ttl_unit"]
        if "archive_path" in override:
            storage_roots["archive"] = override["archive_path"]
        if "documents_path" in override:
            storage_roots["documents"] = override["documents_path"]
        ui_base = deepcopy(base.get("ui", {}))
        ui = {
            "default_document_list": override.get("default_document_list", ui_base.get("default_document_list", "all")),
        }
        return {"quotas": quotas, "retention": retention, "storage_roots": storage_roots, "ui": ui}

    def merged_license(self) -> dict[str, Any]:
        base = _load_yaml(self.license_config_path)
        override = self._override().get("license", {})
        return _deep_merge(base, override)

    def merged_compliance(self) -> dict[str, Any]:
        sec = _load_yaml(self.security_path)
        base = sec.get("compliance", {})
        override = self._override().get("compliance", {})
        return _deep_merge(base, override)

    def merged_branding(self) -> dict[str, Any]:
        defaults = {
            "app_name": os.getenv("UI_APPNAME", "SecuriPDF"),
            "home_description": os.getenv("UI_HOMEDESCRIPTION", "Kurumsal PDF islem platformu"),
            "navbar_name": os.getenv("UI_APPNAMENAVBAR", "SecuriPDF"),
            "default_locale": os.getenv("SYSTEM_DEFAULTLOCALE", "tr-TR"),
            "langs": os.getenv("LANGS", "tr_TR,en_GB"),
            "logo_style": os.getenv("UI_LOGOSTYLE", "classic"),
            "primary_color": "#1d4ed8",
            "accent_color": "#0f766e",
            "customer_logo_b64": "",
            "platform_logo_b64": "",
        }
        override = self._override().get("branding", {})
        return _deep_merge(defaults, override)

    def merged_system(self) -> dict[str, Any]:
        defaults = {
            "max_filesize_mb": int(os.getenv("SYSTEM_MAXFILESIZE", "500")),
            "client_max_body_size": os.getenv("CLIENT_MAX_BODY_SIZE", "500M"),
            "proxy_read_timeout": int(os.getenv("PROXY_READ_TIMEOUT", "3600")),
            "proxy_send_timeout": int(os.getenv("PROXY_SEND_TIMEOUT", "3600")),
        }
        override = self._override().get("system", {})
        return _deep_merge(defaults, override)

    def merged_deployment(self) -> dict[str, Any]:
        defaults = {
            "environment": "dev",
            "backup_retention_days": int(os.getenv("BACKUP_RETENTION_DAYS", "30")),
            "notes": "",
            "server_ip": os.getenv("PUBLIC_SERVER_IP", os.getenv("SERVER_IP", "")).strip(),
            "public_fqdn": os.getenv("PUBLIC_FQDN", os.getenv("KEYCLOAK_HOSTNAME", "localhost")).strip(),
            "keycloak_fqdn": os.getenv(
                "KEYCLOAK_PUBLIC_FQDN",
                os.getenv("KEYCLOAK_HOSTNAME", os.getenv("PUBLIC_FQDN", "localhost")),
            ).strip(),
            "use_https": os.getenv("PUBLIC_USE_HTTPS", os.getenv("OAUTH2_COOKIE_SECURE", "false")).strip().lower()
            in {"1", "true", "yes", "on"},
            "http_port": int(os.getenv("HTTP_PORT", "8080")),
            "https_port": int(os.getenv("HTTPS_PORT", "443")),
            "keycloak_http_port": int(os.getenv("KEYCLOAK_HTTP_PORT", "8090")),
            "break_glass_password_changed": False,
            "ad_login_verified": False,
            "setup_wizard_completed": False,
            "setup_wizard_completed_at": None,
        }
        override = self._override().get("deployment", {})
        merged = _deep_merge(defaults, override)
        if "use_https" in override:
            merged["use_https"] = bool(override["use_https"])
        merged["access_urls"] = self.deployment_access_urls(merged)
        return merged

    @staticmethod
    def deployment_access_urls(dep: dict[str, Any]) -> dict[str, str]:
        fqdn = (dep.get("public_fqdn") or "localhost").strip()
        server_ip = (dep.get("server_ip") or "").strip()
        use_https = bool(dep.get("use_https"))
        http_port = int(dep.get("http_port") or 8080)
        https_port = int(dep.get("https_port") or 443)
        kc_fqdn = (dep.get("keycloak_fqdn") or fqdn).strip()
        kc_port = int(dep.get("keycloak_http_port") or 8090)
        realm = os.getenv("KEYCLOAK_REALM", "securipdf")

        def base_url(host: str, port: int, https: bool) -> str:
            if not host:
                return ""
            scheme = "https" if https else "http"
            default_port = 443 if https else 80
            if port and port not in (default_port, 0):
                return f"{scheme}://{host}:{port}"
            return f"{scheme}://{host}"

        app_port = https_port if use_https else http_port
        app_url = base_url(fqdn, app_port, use_https)
        ip_url = base_url(server_ip, app_port, use_https) if server_ip else ""
        if kc_port in (80, 443):
            kc_url = f"http://{kc_fqdn}"
        else:
            kc_url = f"http://{kc_fqdn}:{kc_port}"
        issuer = f"{kc_url}/realms/{realm}"
        return {
            "app_url": app_url,
            "app_url_ip": ip_url,
            "oauth_callback_url": f"{app_url}/oauth2/callback" if app_url else "",
            "keycloak_admin_url": kc_url,
            "oauth_issuer_url": issuer,
            "sign_out_url": f"{app_url}/oauth2/sign_out" if app_url else "",
        }

    def merged_smtp(self) -> dict[str, Any]:
        platform = _load_yaml(Path(os.getenv("PLATFORM_CONFIG", "/config/platform.yml")))
        mail = platform.get("mail", {})
        defaults = {
            "enabled": os.getenv("SMTP_ENABLED", str(mail.get("enabled", False))).strip().lower() in {"1", "true", "yes", "on"},
            "host": os.getenv("SMTP_HOST", str(mail.get("host", ""))),
            "port": int(os.getenv("SMTP_PORT", mail.get("port", 587))),
            "user": os.getenv("SMTP_USER", str(mail.get("user", ""))),
            "from": os.getenv("SMTP_FROM", str(mail.get("from", ""))),
            "use_tls": os.getenv("SMTP_USE_TLS", str(mail.get("use_tls", True))).strip().lower() not in {"0", "false", "no", "off"},
            "max_attachment_mb": int(os.getenv("SMTP_MAX_ATTACHMENT_MB", mail.get("max_attachment_mb", 25))),
            "auth_enabled": os.getenv("SMTP_AUTH_ENABLED", str(mail.get("auth_enabled", False))).strip().lower()
            in {"1", "true", "yes", "on"},
        }
        override = self._override().get("smtp", {})
        merged = _deep_merge(defaults, override)
        if "enabled" in override:
            merged["enabled"] = bool(override["enabled"])
        if "use_tls" in override:
            merged["use_tls"] = bool(override["use_tls"])
        if "auth_enabled" in override:
            merged["auth_enabled"] = bool(override["auth_enabled"])
        merged["security"] = self._resolve_smtp_security(merged)
        if "auth_enabled" not in override and os.getenv("SMTP_AUTH_ENABLED") is None:
            # Ic ag relay (sifresiz): varsayilan kimlik dogrulama kapali
            if merged["security"] == "none":
                merged["auth_enabled"] = False
        return merged

    @staticmethod
    def _resolve_smtp_security(merged: dict[str, Any]) -> str:
        sec = str(merged.get("security") or "").strip().lower()
        if sec in {"starttls", "ssl", "none"}:
            return sec
        env = os.getenv("SMTP_SECURITY", "").strip().lower()
        if env in {"starttls", "ssl", "none"}:
            return env
        return "starttls" if merged.get("use_tls", True) else "none"

    def get_smtp_password(self) -> str:
        override = self._override().get("smtp", {})
        enc = override.get("password_encrypted")
        if enc:
            try:
                return decrypt_bytes(self.settings.master_key, base64.b64decode(enc)).decode("utf-8")
            except Exception:
                pass
        env_pass = os.getenv("SMTP_PASSWORD", "")
        if env_pass:
            return env_pass
        return ""

    def has_smtp_password(self) -> bool:
        return bool(self.get_smtp_password())

    def apply_smtp_overrides(self, target: "Settings") -> None:
        merged = self.merged_smtp()
        target.smtp_enabled = bool(merged.get("enabled"))
        target.smtp_host = str(merged.get("host") or "")
        target.smtp_port = int(merged.get("port") or 587)
        target.smtp_user = str(merged.get("user") or "")
        target.smtp_from = str(merged.get("from") or "")
        target.smtp_security = str(merged.get("security") or "starttls")
        target.smtp_use_tls = target.smtp_security == "starttls"
        target.smtp_auth_enabled = bool(merged.get("auth_enabled"))
        target.smtp_max_attachment_bytes = int(merged.get("max_attachment_mb") or 25) * 1024 * 1024
        pwd = self.get_smtp_password()
        if pwd:
            target.smtp_password = pwd

    def merged_email_templates(self) -> dict[str, Any]:
        from .email_templates import merge_email_templates

        override = self._override().get("email_templates", {})
        return merge_email_templates(override)

    def get_bind_password(self) -> str:
        override = self._override().get("ldap", {})
        enc = override.get("bind_password_encrypted")
        if enc:
            try:
                return decrypt_bytes(self.settings.master_key, base64.b64decode(enc)).decode("utf-8")
            except Exception:
                pass
        env_pass = os.getenv("LDAP_BIND_PASSWORD", "")
        if env_pass:
            return env_pass
        pwd = self.merged_ldap().get("bind_password", "")
        if pwd and not str(pwd).startswith("${"):
            return str(pwd)
        return ""

    def has_bind_password(self) -> bool:
        return bool(self.get_bind_password())

    def public_view(self) -> dict[str, Any]:
        ldap = self.merged_ldap()
        ldap_public = {k: v for k, v in ldap.items() if k not in ("bind_password", "bind_password_encrypted")}
        ldap_public["bind_password_set"] = self.has_bind_password()
        smtp = self.merged_smtp()
        smtp_public = {k: v for k, v in smtp.items() if k not in ("password", "password_encrypted")}
        smtp_public["password_set"] = self.has_smtp_password()
        return {
            "ldap": ldap_public,
            "vault": self.merged_vault(),
            "license": self.merged_license(),
            "compliance": self.merged_compliance(),
            "branding": self.merged_branding(),
            "system": self.merged_system(),
            "deployment": self.merged_deployment(),
            "smtp": smtp_public,
            "emailTemplates": self.merged_email_templates(),
            "emailTemplatePlaceholders": "{product_name}, {filename}, {user_id}, {timestamp}",
            "overridePath": str(self.override_path),
            "readOnly": {
                "oauth2_client_id": os.getenv("OAUTH2_CLIENT_ID", "securipdf"),
                "oauth2_issuer_url_env": os.getenv("OAUTH2_ISSUER_URL", ""),
                "oauth2_redirect_url_env": os.getenv("OAUTH2_REDIRECT_URL", ""),
                "keycloak_realm": os.getenv("KEYCLOAK_REALM", "securipdf"),
                "http_port": os.getenv("HTTP_PORT", "8080"),
                "keycloak_http_port": os.getenv("KEYCLOAK_HTTP_PORT", "8090"),
                "note": (
                    "Erisim adresleri Operasyon > Ortam ve erisim bolumunden duzenlenir. "
                    "OAuth2 parolalari ve container portlari .env uzerinden kalir; "
                    "prod gecisinde .env ile admin panelindeki FQDN degerlerini eslestirin."
                ),
            },
        }

    def update_section(self, section: str, payload: dict[str, Any], actor: str) -> dict[str, Any]:
        data = self._override()
        section_data = dict(data.get(section, {}))

        if section == "ldap":
            bind_pwd = payload.pop("bind_password", None)
            if bind_pwd:
                enc = base64.b64encode(encrypt_bytes(self.settings.master_key, bind_pwd.encode("utf-8"))).decode("ascii")
                section_data["bind_password_encrypted"] = enc
            groups = payload.pop("groups", None)
            if groups:
                merged_groups = dict(section_data.get("groups", {}))
                merged_groups.update({k: v for k, v in groups.items() if v})
                section_data["groups"] = merged_groups
            section_data.update(payload)
        elif section == "smtp":
            smtp_pwd = payload.pop("password", None)
            if smtp_pwd:
                enc = base64.b64encode(encrypt_bytes(self.settings.master_key, smtp_pwd.encode("utf-8"))).decode("ascii")
                section_data["password_encrypted"] = enc
            section_data.update(payload)
        elif section == "deployment":
            section_data.update(payload)
            if "use_https" in payload:
                section_data["use_https"] = bool(payload["use_https"])
        elif section == "email_templates":
            section_data = _deep_merge(section_data, payload)
        else:
            section_data.update(payload)

        data[section] = section_data
        data["meta"] = {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": actor,
        }
        self._save_override(data)
        return self.public_view()
