from __future__ import annotations

from io import BytesIO

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


def output_error_code(data: bytes | None, tool_id: str) -> str | None:
    """Boş veya araç için geçersiz çıktı — hata kodu veya None."""
    if not data:
        return "OUTPUT_EMPTY"
    if tool_id == "cert-sign" and not is_valid_pdf(data):
        return "CERT_SIGN_INVALID_OUTPUT"
    return None
