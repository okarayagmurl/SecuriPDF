from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pathlib import Path

from sqlalchemy.orm import Session

from .audit import write_audit
from .config import Settings
from .database import DocumentRecord, utcnow
from .settings_store import SettingsStore


def _user_dir(settings: Settings, kind: str, user_id: str) -> Path:
    roots = SettingsStore(settings).merged_vault().get("storage_roots", {})
    root_name = roots.get(kind, kind)
    path = settings.data_path / root_name / user_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def documents_ttl(settings: Settings) -> timedelta:
    retention = SettingsStore(settings).merged_vault().get("retention", {})
    value = int(retention.get("documents_ttl_value", 7))
    unit = str(retention.get("documents_ttl_unit", "days")).lower()
    if value < 1:
        value = 1
    if unit == "hours":
        return timedelta(hours=value)
    return timedelta(days=value)


def archive_at(active_since: datetime | None, settings: Settings) -> datetime | None:
    if not active_since:
        return None
    if active_since.tzinfo is None:
        active_since = active_since.replace(tzinfo=timezone.utc)
    return active_since + documents_ttl(settings)


def move_document_to_archive(
    db: Session,
    settings: Settings,
    row: DocumentRecord,
    *,
    reason: str = "manual",
) -> None:
    if getattr(row, "storage_scope", "documents") == "archive":
        return
    old_path = Path(row.storage_path)
    if not old_path.is_file():
        raise FileNotFoundError("Depolama dosyasi bulunamadi")
    payload = old_path.read_bytes()
    new_path = _user_dir(settings, "archive", row.user_id) / f"{row.id}.enc"
    new_path.write_bytes(payload)
    old_path.unlink(missing_ok=True)
    row.storage_path = str(new_path)
    row.storage_scope = "archive"
    row.folder_id = None
    row.modified_at = utcnow()
    db.commit()
    write_audit(
        settings,
        row.user_id,
        "document.archive",
        row.id,
        {"documentRef": row.id, "reason": reason},
    )


def purge_expired_documents(db: Session, settings: Settings) -> int:
    ttl = documents_ttl(settings)
    if ttl.total_seconds() <= 0:
        return 0
    cutoff = utcnow() - ttl
    rows = (
        db.query(DocumentRecord)
        .filter(
            DocumentRecord.deleted_at.is_(None),
            DocumentRecord.storage_scope == "documents",
            DocumentRecord.pinned == 0,
            DocumentRecord.active_since.isnot(None),
            DocumentRecord.active_since <= cutoff,
        )
        .all()
    )
    moved = 0
    for row in rows:
        try:
            move_document_to_archive(db, settings, row, reason="retention")
            moved += 1
        except Exception as exc:
            print(f"[retention] {row.id}: {exc}")
            db.rollback()
    return moved
