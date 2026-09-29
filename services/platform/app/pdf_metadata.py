"""PDF belge bilgisi ve dosya adı — PyMuPDF."""

from __future__ import annotations

import re
from io import BytesIO
from typing import Any

import fitz

_META_KEYS = ("title", "author", "subject", "keywords")
_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')


class MetadataError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _flag(data: dict[str, Any], key: str) -> bool:
    return str(data.get(key, "")).lower() in {"true", "1", "on", "yes"}


def _first_text_line(doc: fitz.Document) -> str:
    for page in doc:
        text = page.get_text("text") or ""
        for line in text.splitlines():
            cleaned = line.strip()
            if len(cleaned) >= 2:
                return cleaned[:120]
    return ""


def _safe_filename(title: str) -> str:
    name = _ILLEGAL.sub(" ", title).strip()
    name = re.sub(r"\s+", " ", name).strip(" .")
    return (name or "belge")[:80]


def update_pdf_metadata(pdf_bytes: bytes, form_data: dict[str, Any] | None = None) -> bytes:
    if not pdf_bytes or pdf_bytes[:4] != b"%PDF":
        raise MetadataError("INPUT_NOT_PDF")
    data = form_data or {}
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        meta = dict(doc.metadata or {})
        if _flag(data, "deleteAll"):
            for key in ("title", "author", "subject", "keywords", "creator", "producer"):
                meta[key] = ""
            try:
                doc.del_xml_metadata()
            except Exception:
                pass
        changed = _flag(data, "deleteAll")
        for key in _META_KEYS:
            if key not in data:
                continue
            value = str(data.get(key) or "").strip()
            if not value and not _flag(data, "deleteAll"):
                continue
            meta[key] = value
            changed = True
        if not changed:
            raise MetadataError("METADATA_EMPTY")
        doc.set_metadata(meta)
        out = BytesIO()
        doc.save(out, deflate=True, garbage=4)
        return out.getvalue()
    finally:
        doc.close()


def auto_rename_pdf(pdf_bytes: bytes, form_data: dict[str, Any] | None = None) -> tuple[bytes, str]:
    """Başlık varsa onu, yoksa istenirse ilk satırı dosya adı yapar. Başlık PDF'e yazılır."""
    if not pdf_bytes or pdf_bytes[:4] != b"%PDF":
        raise MetadataError("INPUT_NOT_PDF")
    data = form_data or {}
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        meta = dict(doc.metadata or {})
        title = str(meta.get("title") or "").strip()
        if not title and _flag(data, "useFirstTextAsFallback"):
            title = _first_text_line(doc)
        if not title:
            title = _first_text_line(doc)
        if not title:
            raise MetadataError("RENAME_NO_TITLE")
        meta["title"] = title
        doc.set_metadata(meta)
        out = BytesIO()
        doc.save(out, deflate=True, garbage=4)
        return out.getvalue(), f"{_safe_filename(title)}.pdf"
    finally:
        doc.close()
