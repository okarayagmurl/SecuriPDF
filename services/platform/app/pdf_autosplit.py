"""Otomatik ayır — QR yoksa boş sayfa / çoğunlukla boş tarama sayfası ile böl.

Stirling yalnızca resmi QR ayraç arar. Bu yardımcı PyMuPDF ile boş sayfa
bulunca ZIP üretir; QR varsa işlenmez (Stirling yolu kullanılır).
"""

from __future__ import annotations

import io
import zipfile
from typing import Iterable

import fitz

# Ortalama gri > eşik ve düşük Varyans → boş/beyaz sayfa
_BLANK_MEAN_MIN = 245.0
_BLANK_STD_MAX = 12.0
# Pixmap örnekleme: tam sayfa yerine küçük raster
_SAMPLE_MATRIX = fitz.Matrix(0.15, 0.15)


def is_blank_page(page: fitz.Page) -> bool:
    """Metin yok veya neredeyse beyaz bitmap."""
    text = (page.get_text("text") or "").strip()
    if text:
        return False
    try:
        pix = page.get_pixmap(matrix=_SAMPLE_MATRIX, alpha=False)
    except Exception:
        return False
    samples = pix.samples
    if not samples:
        return True
    n = len(samples)
    mean = sum(samples) / n
    if mean < _BLANK_MEAN_MIN:
        return False
    # Varyans (std^2) hesabı
    var = sum((s - mean) ** 2 for s in samples) / n
    return var**0.5 <= _BLANK_STD_MAX


def find_blank_split_indices(doc: fitz.Document) -> list[int]:
    """Ayraç sayfa indeksleri (0-based). Kenar (ilk/son) yalnız ayraçsa atlanır."""
    n = doc.page_count
    if n < 3:
        return []
    blanks = [i for i in range(n) if is_blank_page(doc[i])]
    # Yalnızca iç ayraçlar (0 ve n-1 hariç — belgenin tamamı boş olmasın)
    return [i for i in blanks if 0 < i < n - 1]


def _page_ranges_from_dividers(page_count: int, divider_indices: Iterable[int]) -> list[tuple[int, int]]:
    """divider sayfaları çıktıya dahil edilmez; aralıklar (start, end_exclusive)."""
    divs = sorted(set(divider_indices))
    ranges: list[tuple[int, int]] = []
    start = 0
    for d in divs:
        if d > start:
            ranges.append((start, d))
        start = d + 1
    if start < page_count:
        ranges.append((start, page_count))
    return [r for r in ranges if r[1] > r[0]]


def split_pdf_on_blank_pages(pdf_bytes: bytes, *, duplex_mode: bool = False) -> bytes | None:
    """Boş sayfa ayraçlarıyla ZIP döndür; ayraç yoksa None."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        dividers = find_blank_split_indices(doc)
        if not dividers:
            return None
        if duplex_mode:
            # Stirling: ayraçtan sonraki sayfayı da at (çift taraflı arka yüz)
            expanded: list[int] = []
            for d in dividers:
                expanded.append(d)
                if d + 1 < doc.page_count and (d + 1) not in dividers:
                    expanded.append(d + 1)
            dividers = sorted(set(expanded))

        ranges = _page_ranges_from_dividers(doc.page_count, dividers)
        if len(ranges) < 2:
            return None

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for idx, (a, b) in enumerate(ranges, start=1):
                part = fitz.open()
                part.insert_pdf(doc, from_page=a, to_page=b - 1)
                part_bytes = part.tobytes(deflate=True, garbage=3)
                part.close()
                zf.writestr(f"bolum_{idx}.pdf", part_bytes)
        return buf.getvalue()
    finally:
        doc.close()
