"""Dijital sertifika imzasını PDF'den kaldırır."""

from __future__ import annotations

from io import BytesIO

import fitz

from .pdf_validate import _has_signature_fields


class SignatureRemoveError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _looks_signed(data: bytes) -> bool:
    if _has_signature_fields(data):
        return True
    return b"/ByteRange" in data or b"/Type /Sig" in data or b"/Type/Sig" in data


def remove_cert_signatures(pdf_bytes: bytes) -> bytes:
    if not pdf_bytes or pdf_bytes[:4] != b"%PDF":
        raise SignatureRemoveError("INPUT_NOT_PDF")
    if not _looks_signed(pdf_bytes):
        raise SignatureRemoveError("SIGNATURE_NOT_FOUND")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        sig_type = getattr(fitz, "PDF_WIDGET_TYPE_SIGNATURE", 6)
        for page in doc:
            for widget in list(page.widgets() or []):
                kind = getattr(widget, "field_type", None)
                label = (getattr(widget, "field_type_string", "") or "").lower()
                if kind == sig_type or label == "signature":
                    page.delete_widget(widget)

        catalog = doc.pdf_catalog()
        for key in ("Perms", "DSS", "AcroForm"):
            try:
                doc.xref_set_key(catalog, key, "null")
            except Exception:
                pass

        for xref in range(1, doc.xref_length()):
            try:
                raw = doc.xref_object(xref)
            except Exception:
                continue
            if "/ByteRange" in raw or "/Type /Sig" in raw or "/Type/Sig" in raw:
                try:
                    doc.update_object(xref, "<<>>")
                except Exception:
                    continue

        out = BytesIO()
        doc.save(out, garbage=4, deflate=True, clean=True)
        result = out.getvalue()
        if _looks_signed(result):
            raise SignatureRemoveError("REMOVE_CERT_STILL_SIGNED")
        return result
    finally:
        doc.close()
