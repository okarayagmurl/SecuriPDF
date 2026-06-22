from __future__ import annotations

import socket
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..audit import read_audit, write_audit
from ..auth import AuthUser, get_current_user, require_admin
from ..config import Settings, get_settings
from ..database import UserQuotaRecord, get_db
from ..keycloak_ldap import KeycloakLdapApplier
from ..maintenance import load_tools_config, save_tools_override
from ..license import LicenseService
from ..ops import (
    acknowledge_setup_step,
    create_backup,
    delete_backup,
    get_backup_archive_path,
    get_prod_readiness,
    get_setup_checklist,
    get_system_health,
    list_backups,
    restore_backup,
    run_maintenance_purge,
)
from ..mail import test_smtp_connection
from ..settings_store import SettingsStore

router = APIRouter(prefix="/admin", tags=["admin"])


class QuotaUpdate(BaseModel):
    maxBytes: int


class ToolsUpdate(BaseModel):
    enabled: list[str] = Field(min_length=1)


class LocalUserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=8, max_length=128)
    email: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    roles: list[str] = Field(default_factory=lambda: ["pdf-user"])


class LdapSettingsUpdate(BaseModel):
    host: str | None = None
    url: str | None = None
    base_dn: str | None = None
    users_dn: str | None = None
    groups_dn: str | None = None
    bind_dn: str | None = None
    bind_password: str | None = None
    group_filter: str | None = None
    groups: dict[str, str] | None = None


class VaultSettingsUpdate(BaseModel):
    default_max_bytes_per_user: int | None = None
    max_file_bytes: int | None = None
    soft_delete_days: int | None = None


class LicenseSettingsUpdate(BaseModel):
    expires_at: str | None = None
    license_key: str | None = None
    limits: dict[str, int] | None = None
    enabled_tools: list[str] | None = None


class ComplianceSettingsUpdate(BaseModel):
    analytics_enabled: bool | None = None
    google_visibility: bool | None = None
    survey_disabled: bool | None = None


class BrandingSettingsUpdate(BaseModel):
    app_name: str | None = None
    home_description: str | None = None
    navbar_name: str | None = None
    default_locale: str | None = None
    langs: str | None = None
    logo_style: str | None = None


class SystemSettingsUpdate(BaseModel):
    max_filesize_mb: int | None = None
    client_max_body_size: str | None = None
    proxy_read_timeout: int | None = None
    proxy_send_timeout: int | None = None


class DeploymentSettingsUpdate(BaseModel):
    environment: str | None = None
    backup_retention_days: int | None = None
    notes: str | None = None
    server_ip: str | None = None
    public_fqdn: str | None = None
    keycloak_fqdn: str | None = None
    use_https: bool | None = None


class SmtpSettingsUpdate(BaseModel):
    enabled: bool | None = None
    host: str | None = None
    port: int | None = None
    user: str | None = None
    password: str | None = None
    from_: str | None = Field(default=None, alias="from")
    use_tls: bool | None = None
    security: str | None = None
    auth_enabled: bool | None = None
    max_attachment_mb: int | None = None

    model_config = {"populate_by_name": True}


class SmtpTestRequest(BaseModel):
    recipient: str | None = None


class EmailTemplatesUpdate(BaseModel):
    layout: dict[str, str] | None = None
    document: dict[str, str] | None = None
    smtp_test: dict[str, str] | None = None


class BackupCreateRequest(BaseModel):
    label: str = "manual"


class BackupRestoreRequest(BaseModel):
    confirm: str = Field(min_length=8)


def _ldap_connect_test(host: str, port: int = 389, timeout: float = 3.0) -> tuple[bool, str]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, f"TCP {host}:{port} erisilebilir"
    except OSError as exc:
        return False, f"TCP {host}:{port} basarisiz: {exc}"


@router.get("/users/{user_id}/quota")
def admin_get_quota(
    user_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    row = db.get(UserQuotaRecord, user_id)
    if not row:
        row = UserQuotaRecord(user_id=user_id, max_bytes=settings.default_quota_bytes, used_bytes=0)
        db.add(row)
        db.commit()
        db.refresh(row)
    return {"userId": user_id, "maxBytes": row.max_bytes, "usedBytes": row.used_bytes}


@router.put("/users/{user_id}/quota")
def admin_set_quota(
    user_id: str,
    body: QuotaUpdate,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    row = db.get(UserQuotaRecord, user_id)
    if not row:
        row = UserQuotaRecord(user_id=user_id, max_bytes=body.maxBytes, used_bytes=0)
        db.add(row)
    else:
        row.max_bytes = body.maxBytes
    db.commit()
    write_audit(settings, user.user_id, "admin.quota.update", user_id, {"maxBytes": body.maxBytes})
    return {"userId": user_id, "maxBytes": row.max_bytes, "usedBytes": row.used_bytes}


@router.get("/audit")
def admin_audit(
    userId: str | None = None,
    action: str | None = None,
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    page: int = 1,
    size: int = 50,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    return read_audit(settings, user_id=userId, action=action, from_ts=from_, to_ts=to, page=page, size=size)


@router.get("/ldap/test")
def admin_ldap_test(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    store = SettingsStore(settings)
    ldap = store.merged_ldap()
    host = ldap.get("host", "")
    ok, message = _ldap_connect_test(host) if host else (False, "LDAP host tanimli degil")
    return {
        "ok": ok,
        "host": host,
        "baseDn": ldap.get("base_dn"),
        "usersDn": ldap.get("users_dn"),
        "groupsDn": ldap.get("groups_dn"),
        "bindDn": ldap.get("bind_dn"),
        "groups": ldap.get("groups", {}),
        "groupFilter": ldap.get("group_filter"),
        "bindPasswordSet": store.has_bind_password(),
        "message": message,
        "overridePath": str(store.override_path),
    }


@router.post("/smtp/test")
def admin_smtp_test(
    body: SmtpTestRequest | None = None,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    store = SettingsStore(settings)
    smtp = store.merged_smtp()
    recipient = (body.recipient if body else None) or user.email
    ok, message = test_smtp_connection(settings, recipient if recipient and "@" in recipient else None)
    return {
        "ok": ok,
        "message": message,
        "host": smtp.get("host"),
        "port": smtp.get("port"),
        "from": smtp.get("from"),
        "enabled": smtp.get("enabled"),
        "security": smtp.get("security"),
        "authEnabled": smtp.get("auth_enabled"),
        "useTls": smtp.get("security") == "starttls",
        "passwordSet": store.has_smtp_password(),
        "testRecipient": recipient if ok and recipient and "@" in recipient else None,
    }


@router.get("/settings")
def admin_get_settings(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    return SettingsStore(settings).public_view()


@router.put("/settings/ldap")
def admin_update_ldap(
    body: LdapSettingsUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Guncellenecek alan yok")
    result = SettingsStore(settings).update_section("ldap", payload, user.user_id)
    write_audit(settings, user.user_id, "admin.settings.ldap", "ldap", {"fields": list(payload.keys())})
    return result


@router.put("/settings/vault")
def admin_update_vault(
    body: VaultSettingsUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Guncellenecek alan yok")
    result = SettingsStore(settings).update_section("vault", payload, user.user_id)
    write_audit(settings, user.user_id, "admin.settings.vault", "vault", payload)
    return result


@router.put("/settings/license")
def admin_update_license(
    body: LicenseSettingsUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Guncellenecek alan yok")
    result = SettingsStore(settings).update_section("license", payload, user.user_id)
    write_audit(settings, user.user_id, "admin.settings.license", "license", {"fields": list(payload.keys())})
    return result


@router.put("/settings/compliance")
def admin_update_compliance(
    body: ComplianceSettingsUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Guncellenecek alan yok")
    result = SettingsStore(settings).update_section("compliance", payload, user.user_id)
    write_audit(settings, user.user_id, "admin.settings.compliance", "compliance", payload)
    return result


@router.put("/settings/branding")
def admin_update_branding(
    body: BrandingSettingsUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Guncellenecek alan yok")
    result = SettingsStore(settings).update_section("branding", payload, user.user_id)
    write_audit(settings, user.user_id, "admin.settings.branding", "branding", {"fields": list(payload.keys())})
    return result


@router.put("/settings/system")
def admin_update_system(
    body: SystemSettingsUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Guncellenecek alan yok")
    result = SettingsStore(settings).update_section("system", payload, user.user_id)
    write_audit(settings, user.user_id, "admin.settings.system", "system", payload)
    return result


@router.put("/settings/deployment")
def admin_update_deployment(
    body: DeploymentSettingsUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Guncellenecek alan yok")
    if payload.get("environment") and payload["environment"] not in ("dev", "staging", "prod"):
        raise HTTPException(status_code=400, detail="environment: dev, staging veya prod olmali")
    result = SettingsStore(settings).update_section("deployment", payload, user.user_id)
    write_audit(settings, user.user_id, "admin.settings.deployment", "deployment", payload)
    return result


@router.put("/settings/smtp")
def admin_update_smtp(
    body: SmtpSettingsUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    payload = body.model_dump(exclude_none=True, by_alias=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Guncellenecek alan yok")
    sec = payload.get("security")
    if sec is not None and sec not in ("starttls", "ssl", "none"):
        raise HTTPException(status_code=400, detail="security: starttls, ssl veya none olmali")
    result = SettingsStore(settings).update_section("smtp", payload, user.user_id)
    write_audit(settings, user.user_id, "admin.settings.smtp", "smtp", {"fields": list(payload.keys())})
    return result


@router.put("/settings/email-templates")
def admin_update_email_templates(
    body: EmailTemplatesUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Guncellenecek alan yok")
    result = SettingsStore(settings).update_section("email_templates", payload, user.user_id)
    write_audit(settings, user.user_id, "admin.settings.email_templates", "email_templates", {"sections": list(payload.keys())})
    return result


@router.delete("/settings/email-templates")
def admin_reset_email_templates(
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    store = SettingsStore(settings)
    data = store._override()
    data.pop("email_templates", None)
    store._save_override(data)
    write_audit(settings, user.user_id, "admin.settings.email_templates.reset", "email_templates", {})
    return store.public_view()


@router.get("/ops/health")
def admin_ops_health(
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    return get_system_health(settings, db)


class SetupAcknowledge(BaseModel):
    step: str


@router.get("/ops/setup-checklist")
def admin_setup_checklist(
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
):
    require_admin(user)
    return get_setup_checklist(settings, db)


@router.post("/ops/setup/acknowledge")
def admin_setup_acknowledge(
    body: SetupAcknowledge,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    return acknowledge_setup_step(settings, user.user_id, body.step)


@router.get("/ops/readiness")
def admin_ops_readiness(
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    return get_prod_readiness(settings, db)


@router.get("/ops/backups")
def admin_list_backups(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    return {"items": list_backups(settings)}


@router.post("/ops/backups")
def admin_create_backup(
    body: BackupCreateRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    manifest = create_backup(settings, db, user.user_id, body.label)
    write_audit(settings, user.user_id, "admin.backup.create", manifest["id"], {"label": body.label})
    return manifest


@router.get("/ops/backups/{backup_id}/download")
def admin_download_backup(
    backup_id: str,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    from fastapi.responses import FileResponse

    archive = get_backup_archive_path(settings, backup_id)
    write_audit(settings, user.user_id, "admin.backup.download", backup_id, {})
    return FileResponse(
        path=archive,
        filename=f"securipdf-vault-backup-{backup_id}.tar.gz",
        media_type="application/gzip",
    )


@router.post("/ops/backups/{backup_id}/restore")
def admin_restore_backup(
    backup_id: str,
    body: BackupRestoreRequest,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    result = restore_backup(settings, backup_id, body.confirm)
    write_audit(settings, user.user_id, "admin.backup.restore", backup_id, result)
    return result


@router.delete("/ops/backups/{backup_id}")
def admin_delete_backup(
    backup_id: str,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    delete_backup(settings, backup_id)
    write_audit(settings, user.user_id, "admin.backup.delete", backup_id, {})
    return {"ok": True, "id": backup_id}


@router.post("/ops/maintenance/purge")
def admin_maintenance_purge(
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    result = run_maintenance_purge(db, settings)
    write_audit(settings, user.user_id, "admin.maintenance.purge", "vault", result)
    return result


@router.post("/ldap/apply")
def admin_ldap_apply(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    store = SettingsStore(settings)
    ldap = store.merged_ldap()
    bind_password = store.get_bind_password()
    result = KeycloakLdapApplier().apply(ldap, bind_password)
    write_audit(settings, user.user_id, "admin.ldap.apply", "keycloak", result)
    return result


@router.post("/ldap/sync")
def admin_ldap_sync(
    syncUsers: bool = True,
    syncGroups: bool = True,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    result = KeycloakLdapApplier().sync_ldap(sync_users=syncUsers, sync_groups=syncGroups)
    write_audit(settings, user.user_id, "admin.ldap.sync", "keycloak", result)
    return result


@router.get("/users")
def admin_list_users(
    search: str | None = None,
    page: int = 1,
    size: int = 50,
    federatedOnly: bool = False,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    return KeycloakLdapApplier().list_users(
        search=search,
        page=page,
        size=size,
        federated_only=federatedOnly,
    )


@router.post("/users")
def admin_create_user(
    body: LocalUserCreate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    result = KeycloakLdapApplier().create_local_user(
        username=body.username,
        password=body.password,
        email=body.email,
        first_name=body.firstName,
        last_name=body.lastName,
        roles=body.roles,
    )
    write_audit(settings, user.user_id, "admin.user.create", body.username, result)
    return result


@router.get("/tools")
def admin_tools(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    data = load_tools_config(settings)
    override_path = settings.data_path / "config" / "tools.override.yml"
    return {
        "enabled": data.get("enabled", []),
        "ui": data.get("ui", {}),
        "overridePath": str(override_path) if override_path.exists() else None,
    }


@router.put("/tools")
def admin_update_tools(
    body: ToolsUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    path = save_tools_override(settings, body.enabled)
    write_audit(settings, user.user_id, "admin.tools.update", "tools", {"count": len(body.enabled)})
    return {"ok": True, "enabled": body.enabled, "overridePath": str(path)}


@router.get("/license")
def admin_license(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    return LicenseService(settings).status()
