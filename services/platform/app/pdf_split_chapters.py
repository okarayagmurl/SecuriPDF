"""PDF yer imi / içindekilere göre bölme (platform PyMuPDF).

Stirling /api/v1/general/split-pdf-by-chapters yedek yolu.
bookmarkLevel: 0 = en üst seviye (PyMuPDF level 1), 1 = bir alt seviye vb.
"""

from __future__ import annotations

import io
import re
import zipfile
from typing import Any


class SplitChaptersError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _safe_name(title: str, idx: int) -> str:
    raw = (title or "").strip() or f"bolum_{idx}"
    raw = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", raw)
    raw = re.sub(r"\s+", " ", raw).strip(" ._")
    if len(raw) > 80:
        raw = raw[:80].rstrip(" ._")
    return (raw or f"bolum_{idx}") + ".pdf"


def _parse_level(value: Any, default: int = 0) -> int:
    try:
        lvl = int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default
    return max(0, min(lvl, 20))


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).lower() in {"true", "1", "on", "yes"}


def split_pdf_by_chapters(
    pdf_bytes: bytes,
    *,
    bookmark_level: int | str = 0,
    allow_duplicates: bool | str = False,
    include_metadata: bool | str = False,
) -> bytes:
    """Yer imlerine göre ZIP (bolum_*.pdf) üret."""
    import fitz

    if not pdf_bytes or pdf_bytes[:4] != b"%PDF":
        raise SplitChaptersError("INPUT_NOT_PDF")

    level_max = _parse_level(bookmark_level, 0)
    allow_dup = _as_bool(allow_duplicates, False)
    keep_meta = _as_bool(include_metadata, False)
    # Stirling: level 0 = en üst → PyMuPDF level 1
    max_toc_level = level_max + 1

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        if doc.page_count < 1:
            raise SplitChaptersError("SPLIT_EMPTY_PDF")

        toc = doc.get_toc(simple=True) or []
        if not toc:
            raise SplitChaptersError("SPLIT_NO_BOOKMARKS")

        entries: list[tuple[str, int]] = []
        for item in toc:
            if not item or len(item) < 3:
                continue
            lvl, title, page = int(item[0]), str(item[1] or ""), int(item[2])
            if lvl < 1 or lvl > max_toc_level:
                continue
            if page < 1:
                continue
            page = min(page, doc.page_count)
            entries.append((title, page))

        if not entries:
            raise SplitChaptersError("SPLIT_NO_BOOKMARKS_AT_LEVEL")

        entries.sort(key=lambda x: (x[1], x[0].lower()))
        if not allow_dup:
            deduped: list[tuple[str, int]] = []
            seen_pages: set[int] = set()
            for title, page in entries:
                if page in seen_pages:
                    continue
                seen_pages.add(page)
                deduped.append((title, page))
            entries = deduped

        # Aralıklar: yer imi sayfasından bir sonraki yer imine kadar (1-based → 0-based)
        ranges: list[tuple[str, int, int]] = []
        for i, (title, page_1) in enumerate(entries):
            start = page_1 - 1
            if i + 1 < len(entries):
                end = entries[i + 1][1] - 2
            else:
                end = doc.page_count - 1
            if end < start:
                end = start
            ranges.append((title, start, end))

        # İlk yer iminden önceki sayfalar
        if ranges and ranges[0][1] > 0:
            ranges.insert(0, ("giris", 0, ranges[0][1] - 1))

        if len(ranges) < 1:
            raise SplitChaptersError("SPLIT_NO_CHAPTERS")

        meta = dict(doc.metadata or {}) if keep_meta else None
        buf = io.BytesIO()
        used_names: set[str] = set()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for idx, (title, start, end) in enumerate(ranges, start=1):
                part = fitz.open()
                try:
                    part.insert_pdf(doc, from_page=start, to_page=end)
                    if meta:
                        part.set_metadata(meta)
                    part_bytes = part.tobytes(deflate=True, garbage=3)
                finally:
                    part.close()
                name = _safe_name(title, idx)
                base = name[:-4]
                candidate = name
                n = 1
                while candidate.lower() in used_names:
                    candidate = f"{base}_{n}.pdf"
                    n += 1
                used_names.add(candidate.lower())
                zf.writestr(candidate, part_bytes)

        return buf.getvalue()
    finally:
        doc.close()
