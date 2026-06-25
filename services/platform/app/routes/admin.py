from __future__ import annotations

import csv
import io
import json
import socket
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..audit import read_audit, write_audit
from ..auth import AuthUser, get_current_user, require_admin
from ..config import Settings, get_settings
from ..database import JobRecord, UserQuotaRecord, get_db
from ..keycloak_branding import sync_keycloak_login_logo
from ..keycloak_ldap import KeycloakLdapApplier
from ..maintenance import load_tools_config, save_tools_override
from ..license import LicenseService
from ..user_tool_profiles import (
    create_tool_access_profile,
    delete_tool_access_profile,
    get_tool_access_profile,
    get_user_tool_assignment,
    get_user_tool_profile,
    list_tool_access_profiles,
    list_user_assignments,
    list_user_tool_profiles,
    load_license_packages,
    resolve_package_tool_ids,
    save_user_tool_profile,
    set_user_assignment,
    update_tool_access_profile,
)
from ..tools_catalog import _load_ui_catalog
from ..routes.app_routes import CATEGORY_LABELS, CATEGORY_ORDER
from ..ops import (
    acknowledge_setup_step,
    create_backup,
    delete_backup,
    get_backup_archive_path,
    get_prod_readiness,
    get_setup_checklist,
    get_admin_dashboard,
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
    documents_ttl_value: int | None = Field(None, ge=1)
    documents_ttl_unit: str | None = Field(None, pattern="^(hours|days)$")
    archive_path: str | None = None
    documents_path: str | None = None
    default_document_list: str | None = Field(None, pattern="^(all|root_only)$")


class LicenseSettingsUpdate(BaseModel):
    package: str | None = None
    expires_at: str | None = None
    license_key: str | None = None
    apply_package_limits: bool | None = None
    limits: dict[str, int] | None = None
    enabled_tools: list[str] | None = None


class PackageApplyRequest(BaseModel):
    package: str = Field(min_length=1)


class UserToolProfileUpdate(BaseModel):
    mode: str | None = None
    profile_id: str | None = None
    allowed_tools: list[str] | None = None
    note: str | None = None


class ToolAccessProfileCreate(BaseModel):
    id: str = Field(min_length=2, max_length=48, pattern=r"^[a-z][a-z0-9_-]*$")
    label: str = Field(min_length=1, max_length=120)
    description: str | None = None
    allowed_tools: list[str] = Field(min_length=1)


class ToolAccessProfileUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    allowed_tools: list[str] | None = None


class UserProfileAssignmentUpdate(BaseModel):
    profile_id: str | None = None


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
    primary_color: str | None = None
    accent_color: str | None = None
    platform_logo_b64: str | None = None
    customer_logo_b64: str | None = None


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


@router.get("/quotas")
def admin_list_quotas(
    search: str | None = None,
    page: int = 1,
    size: int = 50,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    query = db.query(UserQuotaRecord)
    if search and search.strip():
        query = query.filter(UserQuotaRecord.user_id.ilike(f"%{search.strip()}%"))
    total = query.count()
    rows = (
        query.order_by(UserQuotaRecord.used_bytes.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )
    items = []
    for row in rows:
        pct = round((row.used_bytes / row.max_bytes) * 100, 1) if row.max_bytes else 0.0
        items.append(
            {
                "userId": row.user_id,
                "maxBytes": row.max_bytes,
                "usedBytes": row.used_bytes,
                "usagePercent": pct,
            }
        )
    return {
        "items": items,
        "total": total,
        "page": page,
        "size": size,
        "defaultMaxBytes": settings.default_quota_bytes,
    }


@router.get("/audit")
def admin_audit(
    userId: str | None = None,
    action: str | None = None,
    actionPrefix: str | None = None,
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    page: int = 1,
    size: int = 50,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    return read_audit(
        settings,
        user_id=userId,
        action=action,
        action_prefix=actionPrefix,
        from_ts=from_,
        to_ts=to,
        page=page,
        size=size,
    )


@router.get("/audit/export")
def admin_audit_export(
    userId: str | None = None,
    action: str | None = None,
    actionPrefix: str | None = None,
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    result = read_audit(
        settings,
        user_id=userId,
        action=action,
        action_prefix=actionPrefix,
        from_ts=from_,
        to_ts=to,
        page=1,
        size=50000,
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["timestamp", "userId", "action", "resource", "detail"])
    for row in result.get("items") or []:
        writer.writerow(
            [
                row.get("timestamp"),
                row.get("userId"),
                row.get("action"),
                row.get("resource"),
                json.dumps(row.get("detail") or {}, ensure_ascii=False),
            ]
        )
    content = "\ufeff" + buf.getvalue()
    return StreamingResponse(
        iter([content]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="securipdf-audit.csv"'},
    )


@router.get("/jobs")
def admin_jobs(
    userId: str | None = None,
    status: str | None = None,
    toolId: str | None = None,
    page: int = 1,
    size: int = 50,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """KVKK: belge adi yok — yalnizca is tipi, ref kimlikleri ve durum."""
    require_admin(user)
    query = db.query(JobRecord)
    if userId:
        query = query.filter(JobRecord.user_id == userId)
    if status:
        query = query.filter(JobRecord.status == status)
    if toolId:
        query = query.filter(JobRecord.tool_id == toolId)
    total = query.count()
    rows = query.order_by(JobRecord.created_at.desc()).offset((page - 1) * size).limit(size).all()

    def _refs(raw: str | None) -> list[str]:
        try:
            data = json.loads(raw or "[]")
            return data if isinstance(data, list) else []
        except json.JSONDecodeError:
            return []

    return {
        "items": [
            {
                "id": r.id,
                "userId": r.user_id,
                "toolId": r.tool_id,
                "operation": r.operation,
                "status": r.status,
                "progress": r.progress,
                "inputRefs": _refs(r.input_refs),
                "outputRef": r.output_ref,
                "errorCode": r.error_code,
                "createdAt": r.created_at.isoformat() if r.created_at else None,
                "completedAt": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "size": size,
        "privacyNote": "Belge adlari loglanmaz; ref kimlikleri ile geriye donuk eslestirme yapilir.",
    }


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
    kc_sync = None
    if "platform_logo_b64" in payload or "customer_logo_b64" in payload:
        kc_sync = sync_keycloak_login_logo(settings)
    if isinstance(result, dict):
        result = {**result, "keycloakLoginLogo": kc_sync}
    else:
        result = {"settings": result, "keycloakLoginLogo": kc_sync}
    return result


@router.post("/settings/branding/sync-keycloak")
def admin_sync_keycloak_branding(
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    kc_sync = sync_keycloak_login_logo(settings)
    write_audit(settings, user.user_id, "admin.settings.branding.keycloak_sync", "branding", kc_sync or {})
    return kc_sync


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


@router.get("/ops/dashboard")
def admin_ops_dashboard(
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    return get_admin_dashboard(settings, db)


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


@router.get("/license/packages")
def admin_license_packages(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    data = load_license_packages(settings)
    current = LicenseService(settings).status()
    packages = []
    for key, spec in (data.get("packages") or {}).items():
        tool_ids = resolve_package_tool_ids(settings, key)
        packages.append(
            {
                "id": key,
                "label": spec.get("label", key),
                "description": spec.get("description", ""),
                "limits": spec.get("limits", {}),
                "toolCount": len(tool_ids),
                "selected": key == current.get("package"),
            }
        )
    return {"packages": packages, "current": current}


@router.post("/license/apply-package")
def admin_apply_license_package(
    body: PackageApplyRequest,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    packages = (load_license_packages(settings).get("packages") or {})
    if body.package not in packages:
        raise HTTPException(status_code=400, detail=f"Bilinmeyen paket: {body.package}")
    tool_ids = resolve_package_tool_ids(settings, body.package)
    payload: dict = {
        "package": body.package,
        "enabled_tools": tool_ids,
        "apply_package_limits": True,
    }
    pkg_limits = packages[body.package].get("limits")
    if pkg_limits:
        payload["limits"] = pkg_limits
    result = SettingsStore(settings).update_section("license", payload, user.user_id)
    write_audit(
        settings,
        user.user_id,
        "admin.license.apply_package",
        body.package,
        {"toolCount": len(tool_ids)},
    )
    return {"ok": True, "license": result.get("license"), "status": LicenseService(settings).status()}


@router.get("/tool-catalog")
def admin_tool_catalog(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    catalog = _load_ui_catalog()
    licensed = set(LicenseService(settings).enabled_tools())
    items = []
    for item in catalog.get("tools") or []:
        tid = str(item.get("id", "")).strip()
        if not tid:
            continue
        cat = item.get("category", "other")
        items.append(
            {
                "id": tid,
                "title": item.get("title", tid),
                "category": cat,
                "categoryLabel": CATEGORY_LABELS.get(cat, cat),
                "licensed": tid in licensed,
            }
        )
    return {
        "tools": items,
        "licensedCount": len([t for t in items if t["licensed"]]),
        "totalCount": len(items),
    }


@router.get("/tool-access-profiles")
def admin_list_access_profiles(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    return {"profiles": list_tool_access_profiles(settings)}


@router.post("/tool-access-profiles")
def admin_create_access_profile(
    body: ToolAccessProfileCreate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    created = create_tool_access_profile(
        settings,
        body.id,
        label=body.label,
        description=body.description,
        allowed_tools=body.allowed_tools,
    )
    write_audit(settings, user.user_id, "admin.tool_access_profile.create", body.id, {"toolCount": created["toolCount"]})
    return {"ok": True, "profile": created}


@router.get("/tool-access-profiles/{profile_id}")
def admin_get_access_profile(
    profile_id: str,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    return {"profile": get_tool_access_profile(settings, profile_id)}


@router.put("/tool-access-profiles/{profile_id}")
def admin_update_access_profile(
    profile_id: str,
    body: ToolAccessProfileUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Guncellenecek alan yok")
    updated = update_tool_access_profile(
        settings,
        profile_id,
        label=payload.get("label"),
        description=payload.get("description"),
        allowed_tools=payload.get("allowed_tools"),
    )
    write_audit(
        settings,
        user.user_id,
        "admin.tool_access_profile.update",
        profile_id,
        {"toolCount": updated["toolCount"]},
    )
    return {"ok": True, "profile": updated}


@router.delete("/tool-access-profiles/{profile_id}")
def admin_delete_access_profile(
    profile_id: str,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    result = delete_tool_access_profile(settings, profile_id)
    write_audit(settings, user.user_id, "admin.tool_access_profile.delete", profile_id, result)
    return result


@router.get("/users/tool-profile-assignments")
def admin_list_assignments(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    assignments = list_user_assignments(settings)
    profiles = {p["id"]: p for p in list_tool_access_profiles(settings)}
    items = []
    for uid, pid in sorted(assignments.items()):
        prof = profiles.get(pid) or {}
        items.append(
            {
                "userId": uid,
                "profileId": pid,
                "profileLabel": prof.get("label", pid),
            }
        )
    return {"assignments": items, "byUser": assignments}


@router.put("/users/{user_id}/tool-profile-assignment")
def admin_set_assignment(
    user_id: str,
    body: UserProfileAssignmentUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    saved = set_user_assignment(settings, user_id, body.profile_id)
    write_audit(
        settings,
        user.user_id,
        "admin.user.profile_assignment",
        user_id,
        {"profileId": saved.get("profileId")},
    )
    return {"ok": True, **saved}


@router.get("/users/tool-profiles")
def admin_list_tool_profiles(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    require_admin(user)
    return {"profiles": list_user_tool_profiles(settings)}


@router.get("/users/{user_id}/tool-profile")
def admin_get_user_tool_profile(
    user_id: str,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    data = get_user_tool_assignment(settings, user_id)
    return {
        "profile": get_user_tool_profile(settings, user_id),
        "licensedTools": data["licensedTools"],
        "effectiveTools": data["effectiveTools"],
        "profileId": data.get("profileId"),
        "accessProfile": data.get("profile"),
    }


@router.put("/users/{user_id}/tool-profile")
def admin_save_user_tool_profile(
    user_id: str,
    body: UserToolProfileUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    require_admin(user)
    if body.profile_id is not None:
        saved = set_user_assignment(settings, user_id, body.profile_id or None)
    elif body.mode:
        save_user_tool_profile(
            settings,
            user_id,
            mode=body.mode,
            allowed_tools=body.allowed_tools,
            note=body.note,
        )
        saved = get_user_tool_assignment(settings, user_id)
    else:
        raise HTTPException(status_code=400, detail="profile_id veya mode gerekli")
    write_audit(
        settings,
        user.user_id,
        "admin.user.tool_profile",
        user_id,
        {"profileId": saved.get("profileId")},
    )
    return {"ok": True, "profile": get_user_tool_profile(settings, user_id), "assignment": saved}
