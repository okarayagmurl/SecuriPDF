from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..audit import read_document_activity, write_audit
from ..auth import AuthUser, decrypt_bytes, encrypt_bytes, get_current_user, new_id, require_admin
from ..config import Settings, get_settings
from ..document_names import resolve_document_filename
from ..http_util import content_disposition
from ..job_queue import enqueue_email_job
from ..mail import send_document_email
from ..database import (
    CertificateRecord,
    DocumentRecord,
    FolderRecord,
    SignatureRecord,
    UserQuotaRecord,
    get_db,
    utcnow,
)
from ..settings_store import SettingsStore
from ..vault_retention import archive_at, move_document_to_archive

router = APIRouter(tags=["vault"])


class PinUpdate(BaseModel):
    pinned: bool


def _download_filename(db: Session, row: DocumentRecord, data: bytes) -> tuple[str, str]:
    """İndirme adı: kayıtlı çift uzantıyı içerik/MIME ile düzelt; DB adını da onar."""
    name, mime = resolve_document_filename(row.name, row.mime_type, data)
    if name != row.name or mime != (row.mime_type or ""):
        row.name = name
        row.mime_type = mime
        row.modified_at = utcnow()
        db.commit()
    return name, mime


def _require_user_email(user: AuthUser) -> str:
    email = (user.email or "").strip()
    if not email or "@" not in email:
        raise HTTPException(
            status_code=400,
            detail=(
                "Hesabinizda kayitli e-posta adresi bulunamadi. "
                "AD/Keycloak e-posta alanini kontrol edin ve oturumu kapatip tekrar acin."
            ),
        )
    return email


def _load_user_document(
    doc_id: str,
    db: Session,
    user: AuthUser,
    settings: Settings,
) -> tuple[DocumentRecord, bytes]:
    row = db.get(DocumentRecord, doc_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Belge bulunamadi")
    payload = Path(row.storage_path).read_bytes()
    data = decrypt_bytes(settings, payload)
    return row, data


@router.get("/me")
def get_profile(user: AuthUser = Depends(get_current_user)):
    return {
        "userId": user.user_id,
        "email": user.email,
        "hasEmail": bool(user.email and "@" in user.email),
    }


def _quota(db: Session, settings: Settings, user_id: str) -> UserQuotaRecord:
    row = db.get(UserQuotaRecord, user_id)
    if not row:
        row = UserQuotaRecord(user_id=user_id, max_bytes=settings.default_quota_bytes, used_bytes=0)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _check_quota(db: Session, settings: Settings, user_id: str, add_bytes: int) -> UserQuotaRecord:
    quota = _quota(db, settings, user_id)
    if quota.used_bytes + add_bytes > quota.max_bytes:
        raise HTTPException(status_code=413, detail=f"Kullanici kotasi asildi ({quota.max_bytes} bayt)")
    return quota


def _user_dir(settings: Settings, kind: str, user_id: str) -> Path:
    roots = _vault_roots(settings)
    root_name = roots.get(kind, kind)
    path = settings.data_path / root_name / user_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _vault_roots(settings: Settings) -> dict:
    return SettingsStore(settings).merged_vault().get("storage_roots", {})


def _norm_parent_id(parent_id: str | None) -> str | None:
    if parent_id is None:
        return None
    cleaned = str(parent_id).strip()
    return cleaned or None


def _build_folder_tree(rows: list[FolderRecord], parent_id: str | None = None) -> list[dict]:
    parent_id = _norm_parent_id(parent_id)
    nodes = []
    for row in rows:
        if _norm_parent_id(row.parent_id) != parent_id:
            continue
        nodes.append(
            {
                "id": row.id,
                "name": row.name,
                "scope": row.scope,
                "parentId": row.parent_id,
                "children": _build_folder_tree(rows, row.id),
            }
        )
    nodes.sort(key=lambda n: n["name"].lower())
    return nodes


@router.get("/quota")
def get_quota(db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    quota = _quota(db, settings, user.user_id)
    remaining = max(0, quota.max_bytes - quota.used_bytes)
    return {
        "userId": user.user_id,
        "maxBytes": quota.max_bytes,
        "usedBytes": quota.used_bytes,
        "remainingBytes": remaining,
    }


@router.get("/folders")
def list_folders(
    scope: str = "documents",
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    if scope not in ("documents", "archive"):
        raise HTTPException(status_code=400, detail="scope documents veya archive olmali")
    rows = (
        db.query(FolderRecord)
        .filter(FolderRecord.user_id == user.user_id, FolderRecord.scope == scope)
        .all()
    )
    return {"scope": scope, "folders": _build_folder_tree(rows)}


@router.post("/folders", status_code=201)
def create_folder(
    name: str = Form(...),
    scope: str = Form("documents"),
    parent_id: str | None = Form(None),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    if scope not in ("documents", "archive"):
        raise HTTPException(status_code=400, detail="Gecersiz scope")
    parent_id = _norm_parent_id(parent_id)
    if parent_id:
        parent = db.get(FolderRecord, parent_id)
        if not parent or parent.user_id != user.user_id or parent.scope != scope:
            raise HTTPException(status_code=404, detail="Ust klasor bulunamadi")
    folder_id = new_id("fld")
    row = FolderRecord(
        id=folder_id,
        user_id=user.user_id,
        scope=scope,
        parent_id=parent_id,
        name=name.strip() or "Yeni klasor",
        created_at=utcnow(),
    )
    db.add(row)
    db.commit()
    write_audit(settings, user.user_id, "folder.create", folder_id, {"scope": scope})
    return {"id": row.id, "name": row.name, "scope": scope, "parentId": parent_id}


@router.get("/documents")
def list_documents(
    page: int = 1,
    size: int = 50,
    scope: str = "documents",
    folder_id: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    query = db.query(DocumentRecord).filter(
        DocumentRecord.user_id == user.user_id,
        DocumentRecord.deleted_at.is_(None),
    )
    if hasattr(DocumentRecord, "storage_scope"):
        query = query.filter(DocumentRecord.storage_scope == scope)
    q_clean = (q or "").strip()
    if q_clean:
        like = f"%{q_clean}%"
        query = query.filter(
            (DocumentRecord.name.ilike(like)) | (DocumentRecord.id.ilike(like))
        )
    elif folder_id:
        folder_id = _norm_parent_id(folder_id)
        query = query.filter(DocumentRecord.folder_id == folder_id)
    elif not folder_id:
        list_mode = SettingsStore(settings).merged_vault().get("ui", {}).get("default_document_list", "all")
        if list_mode == "root_only":
            query = query.filter((DocumentRecord.folder_id.is_(None)) | (DocumentRecord.folder_id == ""))
    total = query.count()
    rows = query.order_by(DocumentRecord.modified_at.desc()).offset((page - 1) * size).limit(size).all()
    quota = _quota(db, settings, user.user_id)

    def _doc_item(row: DocumentRecord) -> dict:
        active_since = getattr(row, "active_since", None) or row.created_at
        pinned = bool(getattr(row, "pinned", 0))
        archive_deadline = None
        if scope == "documents" and not pinned:
            deadline = archive_at(active_since, settings)
            archive_deadline = deadline.isoformat() if deadline else None
        return {
            "id": row.id,
            "documentGuid": row.id,
            "name": resolve_document_filename(row.name, row.mime_type)[0],
            "sizeBytes": row.size_bytes,
            "mimeType": row.mime_type,
            "folderId": getattr(row, "folder_id", None),
            "storageScope": getattr(row, "storage_scope", "documents"),
            "pinned": pinned,
            "activeSince": active_since.isoformat() if active_since else None,
            "archiveAt": archive_deadline,
            "createdAt": row.created_at.isoformat(),
            "modifiedAt": row.modified_at.isoformat(),
        }

    return {
        "scope": scope,
        "folderId": folder_id,
        "query": q_clean or None,
        "items": [_doc_item(row) for row in rows],
        "total": total,
        "quotaBytes": quota.max_bytes,
        "usedBytes": quota.used_bytes,
    }


@router.post("/documents", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    scope: str = Form("documents"),
    folder_id: str | None = Form(None),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    if scope not in ("documents", "archive"):
        raise HTTPException(status_code=400, detail="Gecersiz scope")
    folder_id = _norm_parent_id(folder_id)
    if folder_id:
        folder = db.get(FolderRecord, folder_id)
        if not folder or folder.user_id != user.user_id or folder.scope != scope:
            raise HTTPException(status_code=404, detail="Klasor bulunamadi")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Bos dosya")
    if len(data) > settings.max_file_bytes:
        raise HTTPException(status_code=413, detail="Dosya boyutu limiti asildi")

    _check_quota(db, settings, user.user_id, len(data))
    doc_id = new_id("doc")
    storage_path = _user_dir(settings, scope, user.user_id) / f"{doc_id}.enc"
    storage_path.write_bytes(encrypt_bytes(settings, data))

    name, resolved_mime = resolve_document_filename(
        file.filename or f"{doc_id}.pdf",
        file.content_type,
        data,
    )

    now = utcnow()
    row = DocumentRecord(
        id=doc_id,
        user_id=user.user_id,
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
    quota = _quota(db, settings, user.user_id)
    quota.used_bytes += len(data)
    db.commit()
    try:
        write_audit(
            settings,
            user.user_id,
            "document.upload",
            doc_id,
            {"documentRef": doc_id, "size": len(data), "scope": scope},
        )
    except OSError as exc:
        print(f"[vault] audit yazilamadi (belge yuklendi): {exc}", flush=True)
    return {
        "id": row.id,
        "documentGuid": row.id,
        "name": row.name,
        "sizeBytes": row.size_bytes,
        "mimeType": row.mime_type,
        "folderId": row.folder_id,
        "storageScope": row.storage_scope,
        "createdAt": row.created_at.isoformat(),
        "modifiedAt": row.modified_at.isoformat(),
    }


@router.get("/documents/{doc_id}/activity")
def document_activity(
    doc_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = db.get(DocumentRecord, doc_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Belge bulunamadi")
    events = read_document_activity(settings, user.user_id, doc_id)
    has_upload = any(e.get("action") == "document.upload" for e in events)
    if not has_upload:
        events.append(
            {
                "timestamp": row.created_at.isoformat(),
                "action": "document.upload",
                "label": "Belge yüklendi",
                "documentGuid": row.id,
                "detail": {"documentRef": row.id, "size": row.size_bytes, "scope": getattr(row, "storage_scope", "documents")},
            }
        )
    events.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    return {
        "documentGuid": row.id,
        "name": row.name,
        "createdAt": row.created_at.isoformat(),
        "modifiedAt": row.modified_at.isoformat(),
        "events": events,
    }


@router.get("/documents/{doc_id}")
def download_document(
    doc_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row, data = _load_user_document(doc_id, db, user, settings)
    name, mime = _download_filename(db, row, data)
    return Response(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": content_disposition("attachment", name)},
    )


@router.get("/documents/{doc_id}/preview")
def preview_document(
    doc_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row, data = _load_user_document(doc_id, db, user, settings)
    name, mime = _download_filename(db, row, data)
    return Response(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": content_disposition("inline", name)},
    )


@router.post("/documents/{doc_id}/archive")
def archive_document(
    doc_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = db.get(DocumentRecord, doc_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Belge bulunamadi")
    if getattr(row, "storage_scope", "documents") == "archive":
        raise HTTPException(status_code=400, detail="Belge zaten arsivde")
    try:
        move_document_to_archive(db, settings, row, reason="manual")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Depolama dosyasi bulunamadi")
    return {"id": row.id, "storageScope": "archive", "name": row.name}


@router.put("/documents/{doc_id}/pin")
def pin_document(
    doc_id: str,
    body: PinUpdate,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = db.get(DocumentRecord, doc_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Belge bulunamadi")
    if getattr(row, "storage_scope", "documents") == "archive":
        raise HTTPException(status_code=400, detail="Arsivdeki belgeler sabitlenemez")
    row.pinned = 1 if body.pinned else 0
    row.modified_at = utcnow()
    db.commit()
    write_audit(
        settings,
        user.user_id,
        "document.pin" if body.pinned else "document.unpin",
        doc_id,
        {"documentRef": doc_id, "pinned": body.pinned},
    )
    return {"id": row.id, "pinned": bool(row.pinned)}


@router.post("/documents/{doc_id}/restore")
def restore_document(
    doc_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = db.get(DocumentRecord, doc_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Belge bulunamadi")
    if getattr(row, "storage_scope", "documents") != "archive":
        raise HTTPException(status_code=400, detail="Belge arsivde degil")
    old_path = Path(row.storage_path)
    if not old_path.is_file():
        raise HTTPException(status_code=500, detail="Depolama dosyasi bulunamadi")
    payload = old_path.read_bytes()
    new_path = _user_dir(settings, "documents", user.user_id) / f"{row.id}.enc"
    new_path.write_bytes(payload)
    old_path.unlink(missing_ok=True)
    row.storage_path = str(new_path)
    row.storage_scope = "documents"
    row.folder_id = None
    row.active_since = utcnow()
    row.modified_at = utcnow()
    db.commit()
    write_audit(settings, user.user_id, "document.restore", doc_id, {"documentRef": doc_id})
    return {"id": row.id, "storageScope": "documents", "name": row.name}


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(
    doc_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = db.get(DocumentRecord, doc_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Belge bulunamadi")
    row.deleted_at = utcnow()
    quota = _quota(db, settings, user.user_id)
    quota.used_bytes = max(0, quota.used_bytes - row.size_bytes)
    db.commit()
    write_audit(settings, user.user_id, "document.delete", doc_id)


@router.post("/documents/{doc_id}/email", status_code=202)
def email_document(
    doc_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    to_addr = _require_user_email(user)
    row, _data = _load_user_document(doc_id, db, user, settings)
    job = enqueue_email_job(settings, db, user.user_id, doc_id, to_addr, row.name)
    return {
        "jobId": job.id,
        "sentTo": to_addr,
        "documentName": row.name,
        "documentId": doc_id,
        "status": job.status,
        "progress": job.progress,
    }


@router.post("/documents/email")
async def email_current_document(
    file: UploadFile = File(...),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    to_addr = _require_user_email(user)
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Bos dosya")
    if len(data) > settings.max_file_bytes:
        raise HTTPException(status_code=413, detail="Dosya boyutu limiti asildi")
    filename = file.filename or "belge.pdf"
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"
    send_document_email(
        settings,
        to_addr=to_addr,
        filename=filename,
        pdf_bytes=data,
        user_id=user.user_id,
    )
    write_audit(settings, user.user_id, "document.email.upload", "upload", {"source": "upload"})
    return {"sentTo": to_addr, "documentName": filename}


@router.get("/signatures")
def list_signatures(db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    rows = db.query(SignatureRecord).filter(
        SignatureRecord.user_id == user.user_id,
        SignatureRecord.deleted_at.is_(None),
    ).all()
    return {
        "items": [
            {"id": r.id, "label": r.label, "sizeBytes": r.size_bytes, "mimeType": r.mime_type, "createdAt": r.created_at.isoformat()}
            for r in rows
        ]
    }


@router.post("/signatures", status_code=201)
async def upload_signature(
    file: UploadFile = File(...),
    label: str | None = None,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    data = await file.read()
    if len(data) > settings.max_file_bytes:
        raise HTTPException(status_code=413, detail="Dosya boyutu limiti asildi")
    _check_quota(db, settings, user.user_id, len(data))
    sig_id = new_id("sig")
    path = _user_dir(settings, "signatures", user.user_id) / f"{sig_id}.enc"
    path.write_bytes(encrypt_bytes(settings, data))
    row = SignatureRecord(
        id=sig_id,
        user_id=user.user_id,
        label=label,
        size_bytes=len(data),
        mime_type=file.content_type or "image/png",
        storage_path=str(path),
        created_at=utcnow(),
    )
    db.add(row)
    quota = _quota(db, settings, user.user_id)
    quota.used_bytes += len(data)
    db.commit()
    write_audit(settings, user.user_id, "signature.upload", sig_id)
    return {"id": sig_id, "label": label}


@router.get("/signatures/{sig_id}")
def get_signature(sig_id: str, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    row = db.get(SignatureRecord, sig_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Imza bulunamadi")
    data = decrypt_bytes(settings, Path(row.storage_path).read_bytes())
    return Response(content=data, media_type=row.mime_type)


@router.delete("/signatures/{sig_id}", status_code=204)
def delete_signature(sig_id: str, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    row = db.get(SignatureRecord, sig_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Imza bulunamadi")
    row.deleted_at = utcnow()
    quota = _quota(db, settings, user.user_id)
    quota.used_bytes = max(0, quota.used_bytes - row.size_bytes)
    db.commit()
    write_audit(settings, user.user_id, "signature.delete", sig_id)


@router.get("/certificates")
def list_certificates(db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    rows = db.query(CertificateRecord).filter(
        CertificateRecord.user_id == user.user_id,
        CertificateRecord.deleted_at.is_(None),
    ).all()
    return {
        "items": [
            {
                "id": r.id,
                "subject": r.subject,
                "expiresAt": r.expires_at.isoformat() if r.expires_at else None,
                "label": r.label,
            }
            for r in rows
        ]
    }


@router.post("/certificates", status_code=201)
async def upload_certificate(
    file: UploadFile = File(...),
    password: str | None = None,
    label: str | None = None,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    data = await file.read()
    if len(data) > settings.max_file_bytes:
        raise HTTPException(status_code=413, detail="Dosya boyutu limiti asildi")
    _check_quota(db, settings, user.user_id, len(data))
    cert_id = new_id("cert")
    path = _user_dir(settings, "certificates", user.user_id) / f"{cert_id}.enc"
    # password metadata ile birlikte sifrelenir
    bundle = {"pfx": data.hex(), "password": password or ""}
    path.write_bytes(encrypt_bytes(settings, str(bundle).encode("utf-8")))
    row = CertificateRecord(
        id=cert_id,
        user_id=user.user_id,
        label=label,
        subject=label or file.filename,
        expires_at=None,
        size_bytes=len(data),
        storage_path=str(path),
        created_at=utcnow(),
    )
    db.add(row)
    quota = _quota(db, settings, user.user_id)
    quota.used_bytes += len(data)
    db.commit()
    write_audit(settings, user.user_id, "certificate.upload", cert_id)
    return {"id": cert_id, "label": label, "subject": row.subject}


@router.get("/certificates/{cert_id}/use")
def use_certificate(cert_id: str, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    row = db.get(CertificateRecord, cert_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Sertifika bulunamadi")
    token = new_id("ctok")
    write_audit(settings, user.user_id, "certificate.use", cert_id, {"token": token})
    return {"token": token, "certificateId": cert_id, "expiresInSeconds": 300}


@router.delete("/certificates/{cert_id}", status_code=204)
def delete_certificate(cert_id: str, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    row = db.get(CertificateRecord, cert_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Sertifika bulunamadi")
    row.deleted_at = utcnow()
    quota = _quota(db, settings, user.user_id)
    quota.used_bytes = max(0, quota.used_bytes - row.size_bytes)
    db.commit()
    write_audit(settings, user.user_id, "certificate.delete", cert_id)
