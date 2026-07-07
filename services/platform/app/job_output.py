from __future__ import annotations

import re
import zipfile
from io import BytesIO
from typing import Any


def _fmt(form_data: dict[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        val = form_data.get(key)
        if val is not None and str(val).strip():
            return str(val).strip().lower()
    return default


def _office_zip_kind(data: bytes) -> str | None:
    if len(data) < 4 or data[:2] != b"PK":
        return None
    try:
        with zipfile.ZipFile(BytesIO(data)) as zf:
            names = zf.namelist()
    except zipfile.BadZipFile:
        return None
    joined = " ".join(names[:40]).lower()
    if "word/" in joined or "[content_types].xml" in joined and "wordprocessingml" in joined:
        return "docx"
    if "xl/" in joined or "spreadsheetml" in joined:
        return "xlsx"
    if "ppt/" in joined or "presentationml" in joined:
        return "pptx"
    if "mimetype" in names and any("opendocument.text" in zf.read("mimetype").decode("utf-8", errors="ignore") for _ in [0]):
        return "odt"
    if "content.xml" in names and "meta.xml" in names:
        return "odt"
    return None


def _info(name: str, ext: str, mime: str) -> dict[str, str]:
    return {"default_name": name, "ext": ext, "mime": mime}


def _tool_format_info(tool_id: str, form_data: dict[str, Any]) -> dict[str, str] | None:
    fmt = _fmt(form_data, "outputFormat", "output_format", "imageFormat", "image_format")
    mapping: dict[str, dict[str, tuple[str, str, str]]] = {
        "pdf-to-word": {
            "docx": ("pdf-belge.docx", ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            "odt": ("pdf-belge.odt", ".odt", "application/vnd.oasis.opendocument.text"),
        },
        "pdf-to-presentation": {
            "pptx": ("pdf-sunum.pptx", ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
            "odp": ("pdf-sunum.odp", ".odp", "application/vnd.oasis.opendocument.presentation"),
        },
        "pdf-to-text": {
            "txt": ("pdf-metin.txt", ".txt", "text/plain; charset=utf-8"),
            "rtf": ("pdf-metin.rtf", ".rtf", "application/rtf"),
        },
        "pdf-to-img": {
            "png": ("pdf-sayfa.png", ".png", "image/png"),
            "jpeg": ("pdf-sayfa.jpg", ".jpg", "image/jpeg"),
            "jpg": ("pdf-sayfa.jpg", ".jpg", "image/jpeg"),
            "webp": ("pdf-sayfa.webp", ".webp", "image/webp"),
            "tiff": ("pdf-sayfa.tiff", ".tiff", "image/tiff"),
            "bmp": ("pdf-sayfa.bmp", ".bmp", "image/bmp"),
        },
        "convert": {
            "docx": ("donusturulmus.docx", ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            "odt": ("donusturulmus.odt", ".odt", "application/vnd.oasis.opendocument.text"),
            "doc": ("donusturulmus.doc", ".doc", "application/msword"),
            "pptx": ("donusturulmus.pptx", ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
            "odp": ("donusturulmus.odp", ".odp", "application/vnd.oasis.opendocument.presentation"),
            "xlsx": ("donusturulmus.xlsx", ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            "png": ("donusturulmus.png", ".png", "image/png"),
            "jpg": ("donusturulmus.jpg", ".jpg", "image/jpeg"),
            "jpeg": ("donusturulmus.jpg", ".jpg", "image/jpeg"),
        },
    }
    tool_map = mapping.get(tool_id)
    if not tool_map:
        return None
    key = fmt or next(iter(tool_map))
    if key not in tool_map:
        key = next(iter(tool_map))
    name, ext, mime = tool_map[key]
    single = _fmt(form_data, "singleOrMultiple", "single_or_multiple", default="multiple")
    if tool_id == "pdf-to-img" and single == "single":
        return _info(name, ext, mime)
    if tool_id == "pdf-to-img":
        return _info("pdf-gorseller.zip", ".zip", "application/zip")
    return _info(name, ext, mime)


def ensure_filename_ext(filename: str, ext: str) -> str:
    ext = ext if ext.startswith(".") else f".{ext}"
    if filename.lower().endswith(ext.lower()):
        return filename
    base = re.sub(r"\.[^./\\]+$", "", filename) if "." in filename else filename
    return f"{base}{ext}"


def output_file_info(data: bytes, tool_id: str, form_data: dict[str, Any] | None = None) -> dict[str, str]:
    """Stirling ciktisinin dosya adi, uzantisi ve MIME turunu belirler."""
    form_data = form_data or {}

    tool_info = _tool_format_info(tool_id, form_data)
    if tool_info:
        if tool_id == "pdf-to-img" and tool_info["ext"] != ".zip":
            if data[:8] == b"\x89PNG\r\n\x1a\n":
                return _info("pdf-sayfa.png", ".png", "image/png")
            if data[:3] == b"\xff\xd8\xff":
                return _info("pdf-sayfa.jpg", ".jpg", "image/jpeg")
        if tool_info["ext"] != ".zip" or data[:2] == b"PK":
            office = _office_zip_kind(data) if data[:2] == b"PK" else None
            if office and tool_info["ext"] in (".docx", ".odt", ".pptx", ".xlsx"):
                pass
            elif tool_info["ext"] not in (".zip",):
                return tool_info

    if tool_id == "compare":
        return _info("karsilastirma-raporu.html", ".html", "text/html; charset=utf-8")
    if tool_id == "get-info-on-pdf":
        return _info("pdf-bilgisi.json", ".json", "application/json; charset=utf-8")
    if tool_id == "validate-signature":
        return _info("imza-dogrulama.json", ".json", "application/json; charset=utf-8")
    if tool_id == "verify-pdf":
        return _info("pdf-dogrulama.json", ".json", "application/json; charset=utf-8")
    if tool_id == "pdf-to-csv":
        return _info("pdf-tablo.csv", ".csv", "text/csv; charset=utf-8")
    if tool_id == "pdf-to-xlsx":
        return _info("pdf-tablo.xlsx", ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if tool_id == "pdf-to-markdown":
        return _info("pdf-icerik.md", ".md", "text/markdown; charset=utf-8")
    if tool_id == "pdf-to-xml":
        return _info("pdf-yapi.xml", ".xml", "application/xml; charset=utf-8")
    if tool_id == "pdf-to-epub":
        return _info("pdf-kitap.epub", ".epub", "application/epub+zip")
    if tool_id == "pdf-to-cbz":
        return _info("pdf-sayfalar.cbz", ".cbz", "application/vnd.comicbook+zip")
    if tool_id == "pdf-to-cbr":
        return _info("pdf-sayfalar.cbr", ".cbr", "application/vnd.comicbook-rar")
    if len(data) >= 4 and data[:4] == b"%PDF":
        return _info(f"{tool_id}-sonuc.pdf", ".pdf", "application/pdf")
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return _info("cikti.png", ".png", "image/png")
    if data[:3] == b"\xff\xd8\xff":
        return _info("cikti.jpg", ".jpg", "image/jpeg")
    if len(data) >= 2 and data[:2] == b"PK":
        office = _office_zip_kind(data)
        if office == "docx":
            return _info("cikti.docx", ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        if office == "odt":
            return _info("cikti.odt", ".odt", "application/vnd.oasis.opendocument.text")
        if office == "pptx":
            return _info("cikti.pptx", ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
        if office == "xlsx":
            return _info("cikti.xlsx", ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        zip_names = {
            "split-pages": "bolunmus-belgeler.zip",
            "pdf-to-img": "pdf-gorseller.zip",
            "extract-images": "cikarilan-gorseller.zip",
            "extract-attachments": "pdf-ekleri.zip",
            "extract-image-scans": "tarama-gorselleri.zip",
            "auto-split-pdf": "otomatik-bolunmus.zip",
        }
        zip_name = zip_names.get(tool_id, "cikti.zip")
        return _info(zip_name, ".zip", "application/zip")
    if tool_id in (
        "split-pages",
        "pdf-to-img",
        "extract-images",
        "extract-attachments",
        "extract-image-scans",
        "auto-split-pdf",
    ):
        zip_names = {
            "split-pages": "bolunmus-belgeler.zip",
            "pdf-to-img": "pdf-gorseller.zip",
            "extract-images": "cikarilan-gorseller.zip",
            "extract-attachments": "pdf-ekleri.zip",
            "extract-image-scans": "tarama-gorselleri.zip",
            "auto-split-pdf": "otomatik-bolunmus.zip",
        }
        return _info(zip_names.get(tool_id, "cikti.zip"), ".zip", "application/zip")
    if tool_id == "pdf-to-text":
        return _info("pdf-metin.txt", ".txt", "text/plain; charset=utf-8")
    if tool_id == "pdf-to-html":
        return _info("pdf-sayfa.html", ".html", "text/html; charset=utf-8")
    if data[:1] in (b"{", b"["):
        return _info(f"{tool_id}-sonuc.json", ".json", "application/json; charset=utf-8")
    return _info(f"{tool_id}-sonuc.pdf", ".pdf", "application/pdf")
