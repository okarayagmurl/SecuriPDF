"""PDF izinlerini platformda güncelle (Stirling change-permissions endpoint yok)."""

from __future__ import annotations

from io import BytesIO
from typing import Any

from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions as UAP


class PermissionsError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _flag(form: dict[str, Any], key: str) -> bool:
    return str(form.get(key, "false")).lower() in {"true", "1", "on", "yes"}


def change_permissions(pdf_bytes: bytes, form_data: dict[str, Any]) -> bytes:
    owner = str(form_data.get("ownerPassword") or "").strip()
    if not owner:
        raise PermissionsError("PERMISSIONS_OWNER_PASSWORD_MISSING")

    reader = PdfReader(BytesIO(pdf_bytes), strict=False)
    if getattr(reader, "is_encrypted", False):
        try:
            ok = reader.decrypt(owner)
        except Exception as exc:
            raise PermissionsError("PERMISSIONS_DECRYPT_FAILED") from exc
        if ok == 0:
            # Bazı PDF'lerde sahip parolası user olarak da denenebilir.
            try:
                ok = reader.decrypt(owner)
            except Exception:
                ok = 0
            if ok == 0:
                raise PermissionsError("PERMISSIONS_WRONG_PASSWORD")

    writer = PdfWriter()
    writer.append_pages_from_reader(reader)

    # pypdf: bayrak set = izin verilir. UI "prevent*" işaretliyse engelle.
    perms = UAP(0)
    if not _flag(form_data, "preventPrinting"):
        perms |= UAP.PRINT
        if not _flag(form_data, "preventPrintingFaithful"):
            perms |= UAP.PRINT_TO_REPRESENTATION
    if not _flag(form_data, "preventModify"):
        perms |= UAP.MODIFY
    if not _flag(form_data, "preventModifyAnnotations"):
        perms |= UAP.ADD_OR_MODIFY
    if not _flag(form_data, "preventExtractContent"):
        perms |= UAP.EXTRACT_TEXT_AND_GRAPHICS
    if not _flag(form_data, "preventExtractForAccessibility"):
        perms |= UAP.EXTRACT
    if not _flag(form_data, "preventFillInForm"):
        perms |= UAP.FILL_FORM_FIELDS
    if not _flag(form_data, "preventAssembly"):
        perms |= UAP.ASSEMBLE_DOC

    # Mevcut açma parolasını korumaya çalış; yoksa boş kullanıcı parolası.
    user_pwd = str(form_data.get("password") or "").strip()
    try:
        writer.encrypt(
            user_password=user_pwd,
            owner_password=owner,
            permissions_flag=perms,
            algorithm="AES-256",
        )
    except TypeError:
        writer.encrypt(user_pwd, owner, permissions_flag=int(perms))

    out = BytesIO()
    writer.write(out)
    return out.getvalue()
