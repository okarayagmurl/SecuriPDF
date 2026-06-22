from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..audit import write_audit
from ..auth import AuthUser, decrypt_bytes, encrypt_bytes, get_current_user, new_id, require_admin
from ..config import Settings, get_settings
from ..mail import send_document_email
from ..database import (
    CertificateRecord,
    DocumentRecord,
    SignatureRecord,
    UserQuotaRecord,
    get_db,
    utcnow,
)

router = APIRouter(tags=["vault"])


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
    path = settings.data_path / kind / user_id
    path.mkdir(parents=True, exist_ok=True)
    return path


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


@router.get("/documents")
def list_documents(
    page: int = 1,
    size: int = 50,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    query = db.query(DocumentRecord).filter(
        DocumentRecord.user_id == user.user_id,
        DocumentRecord.deleted_at.is_(None),
    )
    total = query.count()
    rows = query.order_by(DocumentRecord.modified_at.desc()).offset((page - 1) * size).limit(size).all()
    quota = _quota(db, settings, user.user_id)
    return {
        "items": [
            {
                "id": row.id,
                "name": row.name,
                "sizeBytes": row.size_bytes,
                "mimeType": row.mime_type,
                "createdAt": row.created_at.isoformat(),
                "modifiedAt": row.modified_at.isoformat(),
            }
            for row in rows
        ],
        "total": total,
        "quotaBytes": quota.max_bytes,
        "usedBytes": quota.used_bytes,
    }


@router.post("/documents", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Bos dosya")
    if len(data) > settings.max_file_bytes:
        raise HTTPException(status_code=413, detail="Dosya boyutu limiti asildi")

    _check_quota(db, settings, user.user_id, len(data))
    doc_id = new_id("doc")
    storage_path = _user_dir(settings, "documents", user.user_id) / f"{doc_id}.enc"
    storage_path.write_bytes(encrypt_bytes(settings, data))

    now = utcnow()
    row = DocumentRecord(
        id=doc_id,
        user_id=user.user_id,
        name=file.filename or f"{doc_id}.pdf",
        size_bytes=len(data),
        mime_type=file.content_type or "application/pdf",
        storage_path=str(storage_path),
        created_at=now,
        modified_at=now,
    )
    db.add(row)
    quota = _quota(db, settings, user.user_id)
    quota.used_bytes += len(data)
    db.commit()
    write_audit(settings, user.user_id, "document.upload", doc_id, {"name": row.name, "size": len(data)})
    return {
        "id": row.id,
        "name": row.name,
        "sizeBytes": row.size_bytes,
        "mimeType": row.mime_type,
        "createdAt": row.created_at.isoformat(),
        "modifiedAt": row.modified_at.isoformat(),
    }


@router.get("/documents/{doc_id}")
def download_document(
    doc_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = db.get(DocumentRecord, doc_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Belge bulunamadi")
    payload = Path(row.storage_path).read_bytes()
    data = decrypt_bytes(settings, payload)
    return Response(content=data, media_type=row.mime_type, headers={"Content-Disposition": f'attachment; filename="{row.name}"'})


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


@router.post("/documents/{doc_id}/email")
def email_document(
    doc_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    to_addr = _require_user_email(user)
    row, data = _load_user_document(doc_id, db, user, settings)
    send_document_email(
        settings,
        to_addr=to_addr,
        filename=row.name,
        pdf_bytes=data,
        user_id=user.user_id,
    )
    write_audit(settings, user.user_id, "document.email", doc_id, {"to": to_addr, "name": row.name})
    return {"sentTo": to_addr, "documentName": row.name, "documentId": doc_id}


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
    write_audit(settings, user.user_id, "document.email", None, {"to": to_addr, "name": filename, "source": "upload"})
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
