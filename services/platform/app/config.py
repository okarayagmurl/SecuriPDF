from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass
class Settings:
    data_path: Path
    db_path: Path
    master_key: bytes
    default_quota_bytes: int
    max_file_bytes: int
    user_header: str
    email_header: str
    groups_header: str
    admin_role: str
    user_role: str
    audit_log_path: Path
    license_config_path: Path
    security_config_path: Path
    stirling_url: str
    admin_ui_enabled: bool
    smtp_enabled: bool
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_from: str
    smtp_use_tls: bool
    smtp_security: str
    smtp_auth_enabled: bool
    smtp_max_attachment_bytes: int


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def _merged_vault_quotas(data_path: Path, vault_config_path: Path) -> dict[str, Any]:
    base = _load_yaml(vault_config_path)
    quotas = dict(base.get("quotas", {}))
    override = _load_yaml(data_path / "config" / "admin-settings.yml").get("vault", {})
    quotas.update({k: v for k, v in override.items() if k in ("default_max_bytes_per_user", "max_file_bytes")})
    return quotas


def get_settings() -> Settings:
    platform = _load_yaml(Path(os.getenv("PLATFORM_CONFIG", "/config/platform.yml")))
    vault = _load_yaml(Path(os.getenv("VAULT_CONFIG", "/config/vault.yml")))

    storage = platform.get("storage", {})
    auth = platform.get("auth", {})
    quotas = vault.get("quotas", {})
    audit = platform.get("audit", vault.get("audit", {}))
    orchestration = platform.get("orchestration", {})
    mail = platform.get("mail", {})

    master_key_raw = os.getenv("VAULT_MASTER_KEY", "dev-master-key-change-in-production!!")
    master_key = master_key_raw.encode("utf-8")[:32].ljust(32, b"0")

    data_path = Path(storage.get("data_path", "/vault-data"))
    db_path = Path(storage.get("db_path", str(data_path / "metadata.db")))
    vault_config_path = Path(os.getenv("VAULT_CONFIG", "/config/vault.yml"))
    quotas_merged = _merged_vault_quotas(data_path, vault_config_path)

    settings = Settings(
        data_path=data_path,
        db_path=db_path,
        master_key=master_key,
        default_quota_bytes=int(
            quotas_merged.get("default_max_bytes_per_user", quotas.get("default_max_bytes_per_user", 1073741824))
        ),
        max_file_bytes=int(quotas_merged.get("max_file_bytes", quotas.get("max_file_bytes", 524288000))),
        user_header=auth.get("user_header", "X-Auth-Request-User"),
        email_header=auth.get("email_header", "X-Auth-Request-Email"),
        groups_header=auth.get("groups_header", "X-Auth-Request-Groups"),
        admin_role=auth.get("admin_role", "pdf-admin"),
        user_role=auth.get("user_role", "pdf-user"),
        audit_log_path=Path(audit.get("log_path", "/logs/platform-audit.log")),
        license_config_path=Path(os.getenv("LICENSE_CONFIG", "/config/license.yml")),
        security_config_path=Path(os.getenv("SECURITY_CONFIG", "/config/security.yml")),
        stirling_url=orchestration.get("stirling_internal_url", "http://entera-pdf:8080"),
        admin_ui_enabled=bool(platform.get("admin_ui", {}).get("enabled", True)),
        smtp_enabled=_env_bool("SMTP_ENABLED", mail.get("enabled", False)),
        smtp_host=os.getenv("SMTP_HOST", str(mail.get("host", ""))),
        smtp_port=int(os.getenv("SMTP_PORT", mail.get("port", 587))),
        smtp_user=os.getenv("SMTP_USER", str(mail.get("user", ""))),
        smtp_password=os.getenv("SMTP_PASSWORD", str(mail.get("password", ""))),
        smtp_from=os.getenv("SMTP_FROM", str(mail.get("from", ""))),
        smtp_use_tls=_env_bool("SMTP_USE_TLS", mail.get("use_tls", True)),
        smtp_security=_resolve_smtp_security_env(mail),
        smtp_auth_enabled=_env_bool("SMTP_AUTH_ENABLED", mail.get("auth_enabled", False)),
        smtp_max_attachment_bytes=int(
            os.getenv("SMTP_MAX_ATTACHMENT_MB", mail.get("max_attachment_mb", 25))
        )
        * 1024
        * 1024,
    )
    from .settings_store import SettingsStore

    SettingsStore(settings).apply_smtp_overrides(settings)
    return settings


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return bool(default)
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _resolve_smtp_security_env(mail: dict) -> str:
    env = os.getenv("SMTP_SECURITY", str(mail.get("security", ""))).strip().lower()
    if env in {"starttls", "ssl", "none"}:
        return env
    return "starttls" if _env_bool("SMTP_USE_TLS", mail.get("use_tls", True)) else "none"
