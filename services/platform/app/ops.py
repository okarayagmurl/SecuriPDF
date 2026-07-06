from __future__ import annotations

import json
import os
import shutil
import tarfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import Settings
from .database import CertificateRecord, DocumentRecord, JobRecord, SignatureRecord, UserQuotaRecord
from .maintenance import purge_soft_deleted
from .audit import read_audit, write_audit
from .settings_store import SettingsStore

DEV_VAULT_MASTER_KEY = "dev-master-key-change-in-production!!"
BACKUP_KINDS = ("documents", "signatures", "certificates")


def _backups_root(settings: Settings) -> Path:
    path = settings.data_path / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _read_manifest(backup_dir: Path) -> dict[str, Any] | None:
    manifest_path = backup_dir / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _backup_retention_days(settings: Settings) -> int:
    store = SettingsStore(settings)
    deployment = store.merged_deployment()
    return int(deployment.get("backup_retention_days") or 30)


def _apply_backup_retention(settings: Settings) -> int:
    retention_days = _backup_retention_days(settings)
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    removed = 0
    root = _backups_root(settings)
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        manifest = _read_manifest(entry)
        created_raw = (manifest or {}).get("createdAt")
        if not created_raw:
            continue
        try:
            created = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if created >= cutoff:
            continue
        archive = root / f"{entry.name}.tar.gz"
        shutil.rmtree(entry, ignore_errors=True)
        archive.unlink(missing_ok=True)
        removed += 1
    return removed


def _archive_backup_folder(settings: Settings, backup_id: str, backup_dir: Path) -> Path:
    archive_path = _backups_root(settings) / f"{backup_id}.tar.gz"
    with tarfile.open(archive_path, "w:gz") as tar:
        tar.add(backup_dir, arcname=backup_id)
    return archive_path


def collect_vault_stats(db: Session) -> dict[str, Any]:
    doc_count = db.query(DocumentRecord).filter(DocumentRecord.deleted_at.is_(None)).count()
    sig_count = db.query(SignatureRecord).filter(SignatureRecord.deleted_at.is_(None)).count()
    cert_count = db.query(CertificateRecord).filter(CertificateRecord.deleted_at.is_(None)).count()
    soft_deleted = (
        db.query(DocumentRecord).filter(DocumentRecord.deleted_at.isnot(None)).count()
        + db.query(SignatureRecord).filter(SignatureRecord.deleted_at.isnot(None)).count()
        + db.query(CertificateRecord).filter(CertificateRecord.deleted_at.isnot(None)).count()
    )
    quota_rows = db.query(UserQuotaRecord).count()
    used_total = db.query(func.coalesce(func.sum(UserQuotaRecord.used_bytes), 0)).scalar() or 0
    return {
        "documents": doc_count,
        "signatures": sig_count,
        "certificates": cert_count,
        "softDeletedRecords": soft_deleted,
        "usersWithQuota": quota_rows,
        "totalUsedBytes": int(used_total),
    }


def get_disk_stats(settings: Settings) -> dict[str, Any]:
    usage = shutil.disk_usage(settings.data_path)
    free_percent = round((usage.free / usage.total) * 100, 1) if usage.total else 0.0
    backups_bytes = 0
    backups_root = settings.data_path / "backups"
    if backups_root.exists():
        backups_bytes = sum(f.stat().st_size for f in backups_root.rglob("*") if f.is_file())
    return {
        "path": str(settings.data_path),
        "totalBytes": usage.total,
        "usedBytes": usage.total - usage.free,
        "freeBytes": usage.free,
        "freePercent": free_percent,
        "backupsBytes": backups_bytes,
    }


def get_system_health(settings: Settings, db: Session) -> dict[str, Any]:
    backups = list_backups(settings)
    latest_backup = backups[0]["createdAt"] if backups else None
    return {
        "service": "securipdf-platform",
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "vault": collect_vault_stats(db),
        "disk": get_disk_stats(settings),
        "backups": {
            "count": len(backups),
            "latestAt": latest_backup,
            "retentionDays": _backup_retention_days(settings),
        },
        "deployment": SettingsStore(settings).merged_deployment(),
    }


def _audit_has_action(settings: Settings, action: str) -> bool:
    result = read_audit(settings, action=action, page=1, size=1)
    return int(result.get("total") or 0) > 0


def get_setup_checklist(settings: Settings, db: Session) -> dict[str, Any]:
    store = SettingsStore(settings)
    ldap = store.merged_ldap()
    deployment = store.merged_deployment()
    backups = list_backups(settings)
    ldap_host = (ldap.get("host") or os.getenv("LDAP_HOST", "")).strip()

    checks = [
        {
            "id": "ldap_host",
            "label": "LDAP sunucu adresi tanimli",
            "ok": bool(ldap_host),
            "hint": "Yapilandirma > Active Directory — LDAP Host",
            "tab": "settings",
            "manual": False,
        },
        {
            "id": "ldap_bind_password",
            "label": "LDAP bind parolasi kaydedildi",
            "ok": store.has_bind_password(),
            "hint": "Yapilandirma > LDAP — Bind parolasi > Kaydet",
            "tab": "settings",
            "manual": False,
        },
        {
            "id": "ldap_applied",
            "label": "LDAP Keycloak'a uygulandi",
            "ok": _audit_has_action(settings, "admin.ldap.apply"),
            "hint": "Yapilandirma > Keycloak'a uygula",
            "tab": "settings",
            "manual": False,
        },
        {
            "id": "deployment_fqdn",
            "label": "Erisim adresi (FQDN) dogrulandi",
            "ok": bool((deployment.get("public_fqdn") or "").strip())
            and (deployment.get("public_fqdn") or "").strip().lower() not in ("localhost", "127.0.0.1"),
            "hint": "Operasyon > Ortam ve erisim > Sunucu IP / FQDN",
            "tab": "ops",
            "manual": False,
        },
        {
            "id": "vault_backup",
            "label": "Ilk Vault yedegi alindi",
            "ok": len(backups) > 0,
            "hint": "Operasyon > Vault yedekleme > Yedek al",
            "tab": "ops",
            "manual": False,
        },
        {
            "id": "break_glass_password",
            "label": "Kurulum (break-glass) parolasi degistirildi",
            "ok": bool(deployment.get("break_glass_password_changed")),
            "hint": "Keycloak Admin veya yeni yerel admin kullanicisi olusturun",
            "tab": "users",
            "manual": True,
        },
        {
            "id": "ad_login_verified",
            "label": "AD kullanicisi ile giris test edildi",
            "ok": bool(deployment.get("ad_login_verified")),
            "hint": "Tarayicida cikis yapip AD kullanicisi ile giris yapin",
            "tab": None,
            "manual": True,
        },
    ]
    done = sum(1 for c in checks if c["ok"])
    total = len(checks)
    return {
        "complete": done == total or bool(deployment.get("setup_wizard_completed")),
        "progress": {"done": done, "total": total},
        "checks": checks,
        "wizardCompleted": bool(deployment.get("setup_wizard_completed")),
        "wizardCompletedAt": deployment.get("setup_wizard_completed_at"),
    }


def acknowledge_setup_step(settings: Settings, actor: str, step: str) -> dict[str, Any]:
    allowed = {
        "break_glass_password": "break_glass_password_changed",
        "ad_login_verified": "ad_login_verified",
        "wizard_complete": "setup_wizard_completed",
    }
    if step not in allowed:
        raise HTTPException(status_code=400, detail="Gecersiz kurulum adimi")

    store = SettingsStore(settings)
    payload: dict[str, Any] = {allowed[step]: True}
    if step == "wizard_complete":
        payload["setup_wizard_completed_at"] = datetime.now(timezone.utc).isoformat()

    result = store.update_section("deployment", payload, actor)
    write_audit(settings, actor, "admin.setup.acknowledge", step, {"step": step})
    return {"ok": True, "deployment": result.get("deployment", {})}


def get_prod_readiness(settings: Settings, db: Session) -> dict[str, Any]:
    store = SettingsStore(settings)
    deployment = store.merged_deployment()
    disk = get_disk_stats(settings)
    backups = list_backups(settings)
    latest_ok = False
    if backups:
        try:
            latest = datetime.fromisoformat(backups[0]["createdAt"].replace("Z", "+00:00"))
            latest_ok = latest >= datetime.now(timezone.utc) - timedelta(days=7)
        except ValueError:
            latest_ok = False

    master_key = os.getenv("VAULT_MASTER_KEY", DEV_VAULT_MASTER_KEY)
    checks = [
        {
            "id": "vault_master_key",
            "label": "Vault ana anahtari (VAULT_MASTER_KEY) varsayilan degil",
            "ok": master_key not in (DEV_VAULT_MASTER_KEY, "", "CHANGE-ME-32-Char-Vault-Master-Key!!"),
            "severity": "critical",
            "hint": "docker/.env icinde guclu bir VAULT_MASTER_KEY tanimlayin",
        },
        {
            "id": "oauth2_cookie_secure",
            "label": "OAuth2 guvenli cerez (OAUTH2_COOKIE_SECURE=true)",
            "ok": os.getenv("OAUTH2_COOKIE_SECURE", "false").lower() == "true",
            "severity": "critical",
            "hint": "apply-prod-hardening.ps1 veya .env prod sablonu",
        },
        {
            "id": "oauth2_insecure_issuer",
            "label": "OAuth2 issuer dogrulama acik (OAUTH2_INSECURE_ISSUER=false)",
            "ok": os.getenv("OAUTH2_INSECURE_ISSUER", "true").lower() == "false",
            "severity": "critical",
            "hint": "Prod ortamda issuer dogrulamasi kapatilmamali",
        },
        {
            "id": "oauth2_insecure_tls",
            "label": "OAuth2 TLS dogrulama acik (OAUTH2_INSECURE_TLS=false)",
            "ok": os.getenv("OAUTH2_INSECURE_TLS", "true").lower() == "false",
            "severity": "warning",
            "hint": "Ic CA kullaniyorsaniz sertifikayi trust store'a ekleyin",
        },
        {
            "id": "ldap_bind_password",
            "label": "LDAP bind parolasi tanimli",
            "ok": store.has_bind_password(),
            "severity": "warning",
            "hint": "Admin > Yapilandirma > LDAP veya LDAP_BIND_PASSWORD",
        },
        {
            "id": "recent_backup",
            "label": "Son 7 gun icinde Vault yedegi var",
            "ok": latest_ok,
            "severity": "warning",
            "hint": "Operasyon > Yedekleme bolumunden yedek alin",
        },
        {
            "id": "disk_free",
            "label": "Vault disk bos alani >= %10",
            "ok": disk["freePercent"] >= 10,
            "severity": "warning",
            "hint": f"Mevcut bos alan: %{disk['freePercent']}",
        },
        {
            "id": "smtp_configured",
            "label": "SMTP etkin ve sunucu tanimli (belge e-postasi)",
            "ok": (not store.merged_smtp().get("enabled"))
            or (bool(store.merged_smtp().get("host")) and bool(store.merged_smtp().get("from"))),
            "severity": "info",
            "hint": "Admin > Yapilandirma > E-posta (SMTP)",
        },
        {
            "id": "deployment_prod",
            "label": "Ortam prod olarak isaretli",
            "ok": deployment.get("environment") == "prod",
            "severity": "info",
            "hint": "Operasyon > Ortam ve erisim",
        },
        {
            "id": "public_fqdn",
            "label": "Erisim FQDN tanimli (prod)",
            "ok": deployment.get("environment") != "prod"
            or bool((deployment.get("public_fqdn") or "").strip() not in ("", "localhost")),
            "severity": "warning",
            "hint": "Operasyon > Sunucu IP / Erisim FQDN",
        },
    ]
    critical_fail = sum(1 for c in checks if c["severity"] == "critical" and not c["ok"])
    warning_fail = sum(1 for c in checks if c["severity"] == "warning" and not c["ok"])
    ready = critical_fail == 0
    return {
        "ready": ready,
        "criticalFailures": critical_fail,
        "warningFailures": warning_fail,
        "checks": checks,
        "deployment": deployment,
        "hostBackupNote": (
            "Tam stack yedegi (Keycloak Postgres, Stirling volume) icin sunucuda "
            "scripts/backup.sh veya docker/backup-keycloak.ps1 calistirin."
        ),
    }


def get_user_usage_stats(db: Session, user_id: str) -> dict[str, Any]:
    base = db.query(JobRecord).filter(JobRecord.user_id == user_id)
    total = base.count()
    status_counts = dict(
        base.with_entities(JobRecord.status, func.count(JobRecord.id)).group_by(JobRecord.status).all()
    )
    cutoff_7d = datetime.now(timezone.utc) - timedelta(days=7)
    last_7d = base.filter(JobRecord.created_at >= cutoff_7d).count()
    tool_rows = (
        db.query(JobRecord.tool_id, func.count(JobRecord.id))
        .filter(JobRecord.user_id == user_id)
        .group_by(JobRecord.tool_id)
        .order_by(func.count(JobRecord.id).desc())
        .limit(5)
        .all()
    )
    return {
        "total": total,
        "completed": int(status_counts.get("completed", 0)),
        "failed": int(status_counts.get("failed", 0)),
        "queued": int(status_counts.get("queued", 0)),
        "running": int(status_counts.get("running", 0)),
        "last7Days": int(last_7d),
        "topTools": [{"toolId": row[0], "count": int(row[1])} for row in tool_rows],
    }


def get_admin_dashboard(settings: Settings, db: Session) -> dict[str, Any]:
    from .license import LicenseService

    health = get_system_health(settings, db)
    setup = get_setup_checklist(settings, db)
    readiness = get_prod_readiness(settings, db)
    license_status = LicenseService(settings).status()

    status_counts = dict(
        db.query(JobRecord.status, func.count(JobRecord.id)).group_by(JobRecord.status).all()
    )
    cutoff_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    cutoff_7d = datetime.now(timezone.utc) - timedelta(days=7)
    last_24h = (
        db.query(func.count(JobRecord.id)).filter(JobRecord.created_at >= cutoff_24h).scalar() or 0
    )
    last_7d = db.query(func.count(JobRecord.id)).filter(JobRecord.created_at >= cutoff_7d).scalar() or 0
    failed_24h = (
        db.query(func.count(JobRecord.id))
        .filter(JobRecord.status == "failed", JobRecord.created_at >= cutoff_24h)
        .scalar()
        or 0
    )
    tool_rows = (
        db.query(JobRecord.tool_id, func.count(JobRecord.id))
        .group_by(JobRecord.tool_id)
        .order_by(func.count(JobRecord.id).desc())
        .limit(8)
        .all()
    )
    active_jobs = (
        db.query(JobRecord)
        .filter(JobRecord.status.in_(("queued", "running")))
        .order_by(JobRecord.created_at.desc())
        .limit(5)
        .all()
    )
    profile_count = 0
    assignment_count = 0
    try:
        from .user_tool_profiles import list_tool_access_profiles, list_user_assignments

        profile_count = len(list_tool_access_profiles(settings))
        assignment_count = len(list_user_assignments(settings))
    except Exception:
        pass

    return {
        "health": health,
        "setup": {
            "complete": setup.get("complete"),
            "progress": setup.get("progress"),
            "wizardCompleted": setup.get("wizardCompleted"),
        },
        "readiness": {
            "ready": readiness.get("ready"),
            "criticalFailures": readiness.get("criticalFailures"),
            "warningFailures": readiness.get("warningFailures"),
        },
        "license": {
            "package": license_status.get("package"),
            "packageLabel": license_status.get("packageLabel"),
            "valid": license_status.get("valid"),
            "expired": license_status.get("expired"),
            "expiresAt": license_status.get("expiresAt"),
            "enabledToolCount": license_status.get("enabledToolCount"),
        },
        "jobs": {
            "byStatus": status_counts,
            "summary": {
                "total": int(sum(int(v) for v in status_counts.values())),
                "failed": int(status_counts.get("failed", 0)),
                "last24Hours": int(last_24h),
                "failedLast24Hours": int(failed_24h),
                "last7Days": int(last_7d),
            },
            "topTools": [{"toolId": row[0], "count": int(row[1])} for row in tool_rows],
            "active": [
                {
                    "id": j.id,
                    "userId": j.user_id,
                    "toolId": j.tool_id,
                    "status": j.status,
                    "progress": j.progress,
                    "createdAt": j.created_at.isoformat() if j.created_at else None,
                }
                for j in active_jobs
            ],
        },
        "accessProfiles": {
            "profileCount": profile_count,
            "assignmentCount": assignment_count,
        },
    }


def list_backups(settings: Settings) -> list[dict[str, Any]]:
    root = _backups_root(settings)
    items: list[dict[str, Any]] = []
    for entry in sorted(root.iterdir(), reverse=True):
        if not entry.is_dir():
            continue
        manifest = _read_manifest(entry)
        if not manifest:
            continue
        archive = root / f"{entry.name}.tar.gz"
        items.append(
            {
                **manifest,
                "archiveBytes": archive.stat().st_size if archive.exists() else None,
                "folderBytes": sum(f.stat().st_size for f in entry.rglob("*") if f.is_file()),
            }
        )
    return items


def create_backup(settings: Settings, db: Session, actor: str, label: str = "manual") -> dict[str, Any]:
    backup_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    root = _backups_root(settings)
    dest = root / backup_id
    if dest.exists():
        raise HTTPException(status_code=409, detail="Yedek klasoru zaten var")
    dest.mkdir(parents=True)

    if settings.db_path.exists():
        shutil.copy2(settings.db_path, dest / "metadata.db")

    config_src = settings.data_path / "config"
    if config_src.exists():
        shutil.copytree(config_src, dest / "config")

    enc_files = 0
    for kind in BACKUP_KINDS:
        src = settings.data_path / kind
        if src.exists() and any(src.rglob("*")):
            enc_files += sum(1 for _ in src.rglob("*.enc"))
            shutil.make_archive(str(dest / kind), "gztar", root_dir=src)

    stats = collect_vault_stats(db)
    manifest = {
        "id": backup_id,
        "label": label or "manual",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "createdBy": actor,
        "product": "SecuriPDF",
        "version": "1.0",
        "stats": {**stats, "encFiles": enc_files},
    }
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    archive_path = _archive_backup_folder(settings, backup_id, dest)
    removed = _apply_backup_retention(settings)
    manifest["archivePath"] = str(archive_path)
    manifest["archiveBytes"] = archive_path.stat().st_size
    manifest["retentionRemoved"] = removed
    return manifest


def get_backup_archive_path(settings: Settings, backup_id: str) -> Path:
    import re

    if not re.fullmatch(r"\d{8}_\d{6}", backup_id):
        raise HTTPException(status_code=400, detail="Gecersiz yedek kimligi")
    archive = _backups_root(settings) / f"{backup_id}.tar.gz"
    if not archive.exists():
        folder = _backups_root(settings) / backup_id
        if folder.exists():
            return _archive_backup_folder(settings, backup_id, folder)
        raise HTTPException(status_code=404, detail="Yedek bulunamadi")
    return archive


def delete_backup(settings: Settings, backup_id: str) -> None:
    root = _backups_root(settings)
    folder = root / backup_id
    archive = root / f"{backup_id}.tar.gz"
    if not folder.exists() and not archive.exists():
        raise HTTPException(status_code=404, detail="Yedek bulunamadi")
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    archive.unlink(missing_ok=True)


def restore_backup(settings: Settings, backup_id: str, confirm: str) -> dict[str, Any]:
    import re

    if not re.fullmatch(r"\d{8}_\d{6}", backup_id):
        raise HTTPException(status_code=400, detail="Gecersiz yedek kimligi")
    if confirm != backup_id:
        raise HTTPException(status_code=400, detail="Onay metni yedek kimligi ile eslesmiyor")

    root = _backups_root(settings)
    folder = root / backup_id
    if not folder.exists():
        archive = root / f"{backup_id}.tar.gz"
        if not archive.exists():
            raise HTTPException(status_code=404, detail="Yedek bulunamadi")
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(path=root)
        folder = root / backup_id

    manifest = _read_manifest(folder)
    if not manifest:
        raise HTTPException(status_code=400, detail="Gecersiz yedek manifest")

    metadata = folder / "metadata.db"
    if metadata.exists():
        shutil.copy2(metadata, settings.db_path)

    config_src = folder / "config"
    if config_src.exists():
        config_dest = settings.data_path / "config"
        config_dest.mkdir(parents=True, exist_ok=True)
        shutil.copytree(config_src, config_dest, dirs_exist_ok=True)

    restored_kinds: list[str] = []
    for kind in BACKUP_KINDS:
        archive_path = folder / f"{kind}.tar.gz"
        if not archive_path.exists():
            continue
        kind_dest = settings.data_path / kind
        if kind_dest.exists():
            shutil.rmtree(kind_dest)
        kind_dest.mkdir(parents=True)
        shutil.unpack_archive(str(archive_path), extract_dir=str(kind_dest))
        restored_kinds.append(kind)

    return {
        "ok": True,
        "backupId": backup_id,
        "restoredAt": datetime.now(timezone.utc).isoformat(),
        "restoredKinds": restored_kinds,
        "restartRecommended": True,
        "message": "Geri yukleme tamamlandi. securipdf-platform container yeniden baslatilmasi onerilir.",
    }


def run_maintenance_purge(db: Session, settings: Settings) -> dict[str, Any]:
    store = SettingsStore(settings)
    soft_days = int(store.merged_vault().get("retention", {}).get("soft_delete_days") or 30)
    removed = purge_soft_deleted(db, settings, soft_days)
    return {"removed": removed, "softDeleteDays": soft_days}
