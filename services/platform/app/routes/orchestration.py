from __future__ import annotations

import ast
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..audit import write_audit
from ..auth import AuthUser, decrypt_bytes, get_current_user
from ..config import Settings, get_settings
from ..database import CertificateRecord, SignatureRecord, get_db
from ..license import LicenseService

router = APIRouter(prefix="/orchestration", tags=["orchestration"])


def _load_cert_bundle(settings: Settings, storage_path: str) -> tuple[bytes, str]:
    raw = decrypt_bytes(settings, Path(storage_path).read_bytes())
    try:
        bundle = ast.literal_eval(raw.decode("utf-8"))
        pfx_hex = bundle.get("pfx", "")
        password = bundle.get("password", "")
        return bytes.fromhex(pfx_hex), password
    except (ValueError, SyntaxError) as exc:
        raise HTTPException(status_code=500, detail="Sertifika verisi okunamadi") from exc


@router.get("/signatures/{sig_id}/for-stirling")
def signature_for_stirling(
    sig_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Faz 4: Stirling sign aracina Vault imzasini sunar."""
    LicenseService(settings).assert_tool_allowed("sign")
    row = db.get(SignatureRecord, sig_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Imza bulunamadi")
    data = decrypt_bytes(settings, Path(row.storage_path).read_bytes())
    write_audit(settings, user.user_id, "orchestration.signature", sig_id)
    return Response(content=data, media_type=row.mime_type, headers={"X-SecuriPDF-Signature-Id": sig_id})


@router.get("/signatures")
def list_signatures_for_stirling(
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    LicenseService(settings).assert_tool_allowed("sign")
    rows = db.query(SignatureRecord).filter(
        SignatureRecord.user_id == user.user_id,
        SignatureRecord.deleted_at.is_(None),
    ).all()
    return {
        "items": [{"id": r.id, "label": r.label or r.id, "mimeType": r.mime_type} for r in rows]
    }


@router.get("/certificates")
def list_certificates_for_stirling(
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    LicenseService(settings).assert_tool_allowed("cert-sign")
    rows = db.query(CertificateRecord).filter(
        CertificateRecord.user_id == user.user_id,
        CertificateRecord.deleted_at.is_(None),
    ).all()
    return {
        "items": [
            {
                "id": r.id,
                "label": r.label or r.subject or r.id,
                "subject": r.subject,
                "expiresAt": r.expires_at.isoformat() if r.expires_at else None,
            }
            for r in rows
        ]
    }


@router.get("/certificates/{cert_id}/for-stirling")
def certificate_for_stirling(
    cert_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Faz 4: Stirling cert-sign aracina Vault PFX sunar."""
    LicenseService(settings).assert_tool_allowed("cert-sign")
    row = db.get(CertificateRecord, cert_id)
    if not row or row.deleted_at or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Sertifika bulunamadi")
    pfx_data, _password = _load_cert_bundle(settings, row.storage_path)
    write_audit(settings, user.user_id, "orchestration.certificate", cert_id)
    filename = (row.label or cert_id) + ".pfx"
    return Response(
        content=pfx_data,
        media_type="application/x-pkcs12",
        headers={
            "X-SecuriPDF-Certificate-Id": cert_id,
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
