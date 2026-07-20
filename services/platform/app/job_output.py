from __future__ import annotations

import re
import zipfile
from io import BytesIO
from typing import Any


_KNOWN_EXTS = (
    ".docx",
    ".doc",
    ".odt",
    ".pptx",
    ".ppt",
    ".odp",
    ".xlsx",
    ".xls",
    ".ods",
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".tiff",
    ".tif",
    ".bmp",
    ".eps",
    ".ps",
    ".pcl",
    ".xps",
    ".txt",
    ".rtf",
    ".csv",
    ".html",
    ".htm",
    ".json",
    ".xml",
    ".md",
    ".epub",
    ".azw3",
    ".cbr",
    ".cbz",
    ".zip",
)


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
            joined = " ".join(names[:40]).lower()
            if "word/" in joined or ("[content_types].xml" in joined and "wordprocessingml" in joined):
                return "docx"
            if "xl/" in joined or "spreadsheetml" in joined:
                return "xlsx"
            if "ppt/" in joined or "presentationml" in joined:
                return "pptx"
            if "mimetype" in names:
                try:
                    mime = zf.read("mimetype").decode("utf-8", errors="ignore")
                except Exception:
                    mime = ""
                if "opendocument.text" in mime:
                    return "odt"
                if "opendocument.presentation" in mime:
                    return "odp"
                if "opendocument.spreadsheet" in mime:
                    return "ods"
            if "content.xml" in names and "meta.xml" in names:
                return "odt"
    except zipfile.BadZipFile:
        return None
    return None


def _info(name: str, ext: str, mime: str) -> dict[str, str]:
    return {"default_name": name, "ext": ext, "mime": mime}


def _detect_content_info(data: bytes, tool_id: str) -> dict[str, str] | None:
    """Bayt içeriğinden gerçek format — yanlış tool_id/ext etiketini ezer."""
    if len(data) >= 4 and data[:4] == b"%PDF":
        return _info(f"{tool_id}-sonuc.pdf", ".pdf", "application/pdf")
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return _info("cikti.png", ".png", "image/png")
    if data[:3] == b"\xff\xd8\xff":
        return _info("cikti.jpg", ".jpg", "image/jpeg")
    if len(data) >= 4 and data[:4] == b"%!PS":
        return _info("pdf-vektor.eps", ".eps", "application/postscript")
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
        if office == "odp":
            return _info("cikti.odp", ".odp", "application/vnd.oasis.opendocument.presentation")
    return None


def _tool_format_info(tool_id: str, form_data: dict[str, Any]) -> dict[str, str] | None:
    fmt = _fmt(
        form_data,
        "outputFormat",
        "output_format",
        "toExt",
        "_toExt",
        "_outputExt",
        "imageFormat",
        "image_format",
    )
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
        "pdf-to-vector": {
            "eps": ("pdf-vektor.eps", ".eps", "application/postscript"),
            "ps": ("pdf-vektor.ps", ".ps", "application/postscript"),
            "pcl": ("pdf-vektor.pcl", ".pcl", "application/vnd.hp-pcl"),
            "xps": ("pdf-vektor.xps", ".xps", "application/vnd.ms-xpsdocument"),
        },
        "convert": {
            "pdf": ("donusturulmus.pdf", ".pdf", "application/pdf"),
            "docx": ("donusturulmus.docx", ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            "odt": ("donusturulmus.odt", ".odt", "application/vnd.oasis.opendocument.text"),
            "doc": ("donusturulmus.doc", ".doc", "application/msword"),
            "pptx": ("donusturulmus.pptx", ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
            "odp": ("donusturulmus.odp", ".odp", "application/vnd.oasis.opendocument.presentation"),
            "xlsx": ("donusturulmus.xlsx", ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            "csv": ("donusturulmus.csv", ".csv", "text/csv; charset=utf-8"),
            "txt": ("donusturulmus.txt", ".txt", "text/plain; charset=utf-8"),
            "rtf": ("donusturulmus.rtf", ".rtf", "application/rtf"),
            "png": ("donusturulmus.png", ".png", "image/png"),
            "jpg": ("donusturulmus.jpg", ".jpg", "image/jpeg"),
            "jpeg": ("donusturulmus.jpg", ".jpg", "image/jpeg"),
            "gif": ("donusturulmus.gif", ".gif", "image/gif"),
            "webp": ("donusturulmus.webp", ".webp", "image/webp"),
            "tiff": ("donusturulmus.tiff", ".tiff", "image/tiff"),
            "tif": ("donusturulmus.tiff", ".tiff", "image/tiff"),
            "bmp": ("donusturulmus.bmp", ".bmp", "image/bmp"),
            "epub": ("donusturulmus.epub", ".epub", "application/epub+zip"),
            "azw3": ("donusturulmus.azw3", ".azw3", "application/vnd.amazon.ebook"),
            "cbr": ("donusturulmus.cbr", ".cbr", "application/vnd.comicbook-rar"),
            "cbz": ("donusturulmus.cbz", ".cbz", "application/vnd.comicbook+zip"),
            "pdfa": ("donusturulmus.pdf", ".pdf", "application/pdf"),
            "pdfx": ("donusturulmus.pdf", ".pdf", "application/pdf"),
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
    if tool_id in ("pdf-to-img", "convert") and ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".tiff", ".bmp"}:
        if single == "single":
            return _info(name, ext, mime)
        return _info("pdf-gorseller.zip", ".zip", "application/zip")
    return _info(name, ext, mime)


def filename_stem(filename: str) -> str:
    """Çift uzantıları temizle (deneme.docx.pdf → deneme)."""
    name = (filename or "").strip() or "cikti"
    name = name.replace("\\", "/").split("/")[-1]
    lowered = name.lower()
    changed = True
    while changed:
        changed = False
        for ext in _KNOWN_EXTS:
            if lowered.endswith(ext) and len(name) > len(ext):
                name = name[: -len(ext)]
                lowered = name.lower()
                changed = True
                break
    name = re.sub(r"[.\s]+$", "", name).strip()
    return name or "cikti"


def ensure_filename_ext(filename: str, ext: str) -> str:
    ext = ext if ext.startswith(".") else f".{ext}"
    return f"{filename_stem(filename)}{ext}"


def output_file_info(data: bytes, tool_id: str, form_data: dict[str, Any] | None = None) -> dict[str, str]:
    """Stirling ciktisinin dosya adi, uzantisi ve MIME turunu belirler."""
    form_data = form_data or {}
    detected = _detect_content_info(data, tool_id)
    tool_info = _tool_format_info(tool_id, form_data)

    # İçerik PDF iken docx/pptx diye etiketleme (açılmayan dosya).
    if detected and tool_info and detected["ext"] != tool_info["ext"]:
        if detected["ext"] == ".pdf" or tool_info["ext"] in {
            ".docx",
            ".odt",
            ".pptx",
            ".odp",
            ".xlsx",
            ".eps",
            ".ps",
            ".pcl",
            ".xps",
        }:
            # Beklenen office/vektor ama içerik PDF → gerçek içeriği kullan
            if detected["ext"] == ".pdf" and tool_info["ext"] != ".pdf":
                return detected
            # Beklenen PDF ama office geldi → office doğru
            if tool_info["ext"] == ".pdf" and detected["ext"] != ".pdf":
                return detected

    if tool_info:
        if tool_id == "pdf-to-img" and tool_info["ext"] != ".zip":
            if data[:8] == b"\x89PNG\r\n\x1a\n":
                return _info("pdf-sayfa.png", ".png", "image/png")
            if data[:3] == b"\xff\xd8\xff":
                return _info("pdf-sayfa.jpg", ".jpg", "image/jpeg")
        if tool_info["ext"] == ".zip":
            if data[:2] == b"PK":
                return tool_info
        elif detected and detected["ext"] == tool_info["ext"]:
            return _info(tool_info["default_name"], tool_info["ext"], tool_info["mime"])
        elif not detected:
            return tool_info
        else:
            # İçerik ile uyumlu tool default adı
            return _info(
                ensure_filename_ext(tool_info["default_name"], detected["ext"]),
                detected["ext"],
                detected["mime"],
            )

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
    if detected:
        return detected
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
