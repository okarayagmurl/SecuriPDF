from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from .audit import write_audit
from .auth import encrypt_bytes, new_id
from .config import Settings
from .database import DocumentRecord, FolderRecord, UserQuotaRecord, utcnow
from .settings_store import SettingsStore


def _mime_from_name(name: str) -> str:
    lower = name.lower()
    if lower.endswith(".zip"):
        return "application/zip"
    if lower.endswith(".html") or lower.endswith(".htm"):
        return "text/html"
    return "application/pdf"


def _ensure_extension(name: str, mime_type: str) -> str:
    lower = name.lower()
    if lower.endswith((".pdf", ".zip", ".html", ".htm")):
        return name
    if mime_type == "application/zip":
        return f"{name}.zip"
    if mime_type == "text/html":
        return f"{name}.html"
    return f"{name}.pdf"


def _user_dir(settings: Settings, kind: str, user_id: str) -> Path:
    roots = SettingsStore(settings).merged_vault().get("storage_roots", {})
    root_name = roots.get(kind, kind)
    path = settings.data_path / root_name / user_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _quota(db: Session, settings: Settings, user_id: str) -> UserQuotaRecord:
    row = db.get(UserQuotaRecord, user_id)
    if not row:
        row = UserQuotaRecord(user_id=user_id, max_bytes=settings.default_quota_bytes, used_bytes=0)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _norm_parent_id(parent_id: str | None) -> str | None:
    if parent_id is None:
        return None
    cleaned = str(parent_id).strip()
    return cleaned or None


def store_document_bytes(
    db: Session,
    settings: Settings,
    user_id: str,
    data: bytes,
    filename: str,
    *,
    scope: str = "documents",
    folder_id: str | None = None,
    doc_id: str | None = None,
    mime_type: str | None = None,
    audit_action: str = "document.upload",
    audit_detail: dict | None = None,
) -> DocumentRecord:
    if not data:
        raise ValueError("Bos dosya")
    if len(data) > settings.max_file_bytes:
        raise ValueError("Dosya boyutu limiti asildi")

    folder_id = _norm_parent_id(folder_id)
    if folder_id:
        folder = db.get(FolderRecord, folder_id)
        if not folder or folder.user_id != user_id or folder.scope != scope:
            raise ValueError("Klasor bulunamadi")

    quota = _quota(db, settings, user_id)
    if quota.used_bytes + len(data) > quota.max_bytes:
        raise ValueError("Kullanici kotasi asildi")

    if doc_id and db.get(DocumentRecord, doc_id):
        raise ValueError("Belge numarasi zaten kullaniliyor")

    doc_id = doc_id or new_id("doc")
    storage_path = _user_dir(settings, scope, user_id) / f"{doc_id}.enc"
    storage_path.write_bytes(encrypt_bytes(settings, data))

    name = (filename or f"{doc_id}.pdf").strip()
    resolved_mime = mime_type or _mime_from_name(name)
    name = _ensure_extension(name, resolved_mime)

    now = utcnow()
    row = DocumentRecord(
        id=doc_id,
        user_id=user_id,
        name=name,
        size_bytes=len(data),
        mime_type=resolved_mime,
        storage_path=str(storage_path),
        folder_id=folder_id,
        storage_scope=scope,
        pinned=0,
        active_since=now,
        created_at=now,
        modified_at=now,
    )
    db.add(row)
    quota.used_bytes += len(data)
    db.commit()
    db.refresh(row)

    detail = {"documentRef": doc_id, "size": len(data), "scope": scope}
    if audit_detail:
        detail.update(audit_detail)
    write_audit(settings, user_id, audit_action, doc_id, detail)
    return row
