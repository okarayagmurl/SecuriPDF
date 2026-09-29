"""PDF Temizle — PyMuPDF (font silmeden JS/ek/meta/link temizliği)."""

from __future__ import annotations

from io import BytesIO
from typing import Any

import fitz


def sanitize_pdf_bytes(pdf_bytes: bytes, form_data: dict[str, Any] | None = None) -> bytes:
    """Stirling sanitizeFonts gömülyü silip bozuk glif üretebilir; burası fontlara dokunmaz.

    scrub clean_pages/hidden_text/redactions kapalı — içerik yeniden yazılmaz.
    """
    data = form_data or {}

    def flag(key: str, default: bool) -> bool:
        raw = data.get(key)
        if raw is None:
            return default
        return str(raw).lower() in {"true", "1", "on", "yes"}

    remove_js = flag("removeJavaScript", True)
    remove_embedded = flag("removeEmbeddedFiles", True)
    remove_xmp = flag("removeXMPMetadata", True)
    remove_meta = flag("removeMetadata", True)
    remove_links = flag("removeLinks", True)

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        doc.scrub(
            attached_files=remove_embedded,
            clean_pages=False,
            embedded_files=remove_embedded,
            hidden_text=False,
            javascript=remove_js,
            metadata=remove_meta,
            redactions=False,
            redact_images=0,
            remove_links=remove_links,
            reset_fields=False,
            reset_responses=False,
            thumbnails=False,
            xml_metadata=remove_xmp,
        )
        if remove_links:
            for page in doc:
                for link in list(page.get_links() or []):
                    try:
                        page.delete_link(link)
                    except Exception:
                        continue
        if remove_embedded:
            while doc.embfile_count():
                doc.embfile_del(0)
        if remove_meta or remove_xmp:
            meta = dict(doc.metadata or {})
            if remove_meta:
                for key in ("title", "author", "subject", "keywords", "creator", "producer"):
                    meta[key] = ""
                doc.set_metadata(meta)
            if remove_xmp:
                try:
                    doc.del_xml_metadata()
                except Exception:
                    pass
        if remove_js:
            catalog = doc.pdf_catalog()
            for key in ("OpenAction", "AA"):
                try:
                    doc.xref_set_key(catalog, key, "null")
                except Exception:
                    continue

        out = BytesIO()
        doc.save(out, deflate=True, garbage=4)
        return out.getvalue()
    finally:
        doc.close()
