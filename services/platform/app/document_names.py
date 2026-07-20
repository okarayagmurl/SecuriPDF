from __future__ import annotations

from io import BytesIO
from zipfile import ZipFile

from .job_output import ensure_filename_ext


_MIME_EXT: dict[str, str] = {
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "text/html": ".html",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "text/markdown": ".md",
    "application/json": ".json",
    "application/xml": ".xml",
    "application/rtf": ".rtf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/tiff": ".tiff",
    "image/bmp": ".bmp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.oasis.opendocument.text": ".odt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.oasis.opendocument.presentation": ".odp",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.oasis.opendocument.spreadsheet": ".ods",
    "application/msword": ".doc",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.ms-excel": ".xls",
    "application/epub+zip": ".epub",
    "application/vnd.comicbook+zip": ".cbz",
    "application/vnd.comicbook-rar": ".cbr",
    "application/postscript": ".eps",
    "application/vnd.hp-pcl": ".pcl",
    "application/vnd.ms-xpsdocument": ".xps",
}


def mime_from_name(name: str) -> str:
    lower = (name or "").lower()
    for mime, ext in _MIME_EXT.items():
        if lower.endswith(ext):
            return mime
    if lower.endswith((".html", ".htm")):
        return "text/html"
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    return "application/pdf"


def ext_for_mime(mime_type: str | None) -> str:
    if not mime_type:
        return ".pdf"
    base = mime_type.split(";")[0].strip().lower()
    if base in _MIME_EXT:
        return _MIME_EXT[base]
    if base in {"text/html", "application/xhtml+xml"}:
        return ".html"
    if base.startswith("image/"):
        subtype = base.split("/", 1)[-1]
        if subtype == "jpeg":
            return ".jpg"
        return f".{subtype}"
    return ".pdf"


def ext_from_content(data: bytes | None) -> str | None:
    if not data:
        return None
    if data[:4] == b"%PDF":
        return ".pdf"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:4] == b"%!PS":
        return ".eps"
    if data[:2] == b"PK":
        try:
            with ZipFile(BytesIO(data)) as zf:
                names = " ".join(zf.namelist()[:40]).lower()
                if "word/" in names or "wordprocessingml" in names:
                    return ".docx"
                if "ppt/" in names or "presentationml" in names:
                    return ".pptx"
                if "xl/" in names or "spreadsheetml" in names:
                    return ".xlsx"
                if "mimetype" in zf.namelist():
                    mime = zf.read("mimetype").decode("utf-8", errors="ignore")
                    if "opendocument.text" in mime:
                        return ".odt"
                    if "opendocument.presentation" in mime:
                        return ".odp"
                    if "opendocument.spreadsheet" in mime:
                        return ".ods"
                    if "epub" in mime:
                        return ".epub"
        except Exception:
            return ".zip"
        return ".zip"
    return None


def resolve_document_filename(
    filename: str,
    mime_type: str | None = None,
    data: bytes | None = None,
) -> tuple[str, str]:
    """Tek uzantılı güvenli belge adı + MIME. Çift uzantıyı (docx.pdf) temizler."""
    content_ext = ext_from_content(data)
    mime_ext = ext_for_mime(mime_type)
    # İçerik varsa onu önceliklendir (yanlış kaydedilmiş .docx.pdf vb.).
    ext = content_ext or mime_ext or ".pdf"
    name = ensure_filename_ext(filename or "belge", ext)
    resolved_mime = (mime_type or "").split(";")[0].strip() if mime_type else ""
    if content_ext:
        # İçeriğe uyan MIME tercih et
        for mime, mapped in _MIME_EXT.items():
            if mapped == content_ext:
                resolved_mime = mime
                break
    if not resolved_mime:
        resolved_mime = mime_from_name(name)
    return name, resolved_mime
