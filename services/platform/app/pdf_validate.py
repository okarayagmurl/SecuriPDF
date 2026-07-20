from __future__ import annotations

import json
from io import BytesIO
from zipfile import ZipFile

from pypdf import PdfReader


def is_valid_pdf(data: bytes, *, min_size: int = 64) -> bool:
    """Geçerli PDF bayt dizisi mi (boş / HTML / JSON hatalarını eler)."""
    if not data or len(data) < min_size:
        return False
    if data[:4] != b"%PDF":
        return False
    try:
        reader = PdfReader(BytesIO(data), strict=False)
        if not reader.pages:
            return False
        _ = len(reader.pages)
    except Exception:
        return False
    return True


def _zip_entry_count(data: bytes) -> int:
    try:
        with ZipFile(BytesIO(data)) as zf:
            return sum(1 for info in zf.infolist() if not info.is_dir())
    except Exception:
        return 0


def _has_signature_fields(data: bytes) -> bool:
    try:
        reader = PdfReader(BytesIO(data), strict=False)
        root = reader.trailer.get("/Root") if reader.trailer else None
        if root is None:
            return False
        acro = root.get("/AcroForm") if hasattr(root, "get") else None
        if acro is None:
            return False
        fields = acro.get("/Fields") if hasattr(acro, "get") else None
        if not fields:
            return False
        for field in fields:
            try:
                obj = field.get_object() if hasattr(field, "get_object") else field
                ft = obj.get("/FT") if hasattr(obj, "get") else None
                if str(ft) == "/Sig":
                    return True
            except Exception:
                continue
        return False
    except Exception:
        return b"/Type /Sig" in data or b"/ByteRange" in data


def output_error_code(
    data: bytes | None,
    tool_id: str,
    form_data: dict | None = None,
) -> str | None:
    """Boş veya araç için geçersiz çıktı — hata kodu veya None."""
    form_data = form_data or {}
    if not data:
        return "OUTPUT_EMPTY"
    if tool_id == "cert-sign" and not is_valid_pdf(data):
        return "CERT_SIGN_INVALID_OUTPUT"
    if tool_id == "validate-signature":
        if data[:4] == b"%PDF":
            return "VALIDATE_SIGNATURE_PDF_OUTPUT"
        try:
            parsed = json.loads(data.decode("utf-8", errors="replace"))
            if not isinstance(parsed, (dict, list)):
                return "VALIDATE_SIGNATURE_INVALID_OUTPUT"
        except Exception:
            return "VALIDATE_SIGNATURE_INVALID_OUTPUT"
    if tool_id == "remove-cert-sign":
        if not is_valid_pdf(data):
            return "REMOVE_CERT_INVALID_OUTPUT"
        if _has_signature_fields(data):
            return "REMOVE_CERT_STILL_SIGNED"
    if tool_id in {"extract-images", "extract-attachments"}:
        if data[:2] == b"PK" and _zip_entry_count(data) == 0:
            return "EXTRACT_EMPTY"
    if tool_id == "pdf-to-vector":
        # Ghostscript bazen HTML/PDF hata gövdesi veya yanlış format döner.
        if data[:4] == b"%PDF" or data[:1] in (b"{", b"<") or data[:15].lower().startswith(b"<!doctype"):
            return "VECTOR_OUTPUT_MISMATCH"
        if len(data) < 32:
            return "VECTOR_OUTPUT_MISMATCH"
    # PDF→Office: Stirling bazen dönüştürmeden PDF döner (açılmayan .docx.pdf).
    office_tools = {"pdf-to-word", "pdf-to-presentation"}
    to_ext = str(
        form_data.get("toExt")
        or form_data.get("_toExt")
        or form_data.get("outputFormat")
        or form_data.get("output_format")
        or ""
    ).strip().lower()
    if tool_id == "convert" and to_ext in {"docx", "odt", "pptx", "odp"}:
        office_tools = office_tools | {"convert"}
    if tool_id in office_tools and data[:4] == b"%PDF":
        return "OFFICE_CONVERT_STILL_PDF"
    if tool_id in office_tools and data[:2] != b"PK":
        return "OFFICE_CONVERT_INVALID"
    # Office/HTML/EML → PDF beklenen araçlar.
    pdf_out_tools = {
        "file-to-pdf",
        "eml-to-pdf",
        "cbz-to-pdf",
        "cbr-to-pdf",
        "ebook-to-pdf",
        "img-to-pdf",
        "url-to-pdf",
        "html-to-pdf",
        "markdown-to-pdf",
        "scanner-effect",
    }
    if tool_id == "convert" and to_ext in {"pdf", "pdfa", "pdfx", ""}:
        # Convert + PDF hedefi (veya boş — çoğu office→pdf yolu).
        if to_ext in {"pdf", "pdfa", "pdfx"}:
            pdf_out_tools = pdf_out_tools | {"convert"}
    if tool_id in pdf_out_tools:
        if not is_valid_pdf(data):
            return "PDF_OUTPUT_INVALID"
    return None
