from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader, PdfWriter


def extract_single_page(pdf_bytes: bytes, page_1based: int) -> bytes:
    reader = PdfReader(BytesIO(pdf_bytes))
    total = len(reader.pages)
    if total < 1:
        raise ValueError("PDF sayfasi yok")
    idx = max(1, min(page_1based, total)) - 1
    writer = PdfWriter()
    writer.add_page(reader.pages[idx])
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


def replace_single_page(original: bytes, page_1based: int, replacement: bytes) -> bytes:
    orig = PdfReader(BytesIO(original))
    repl = PdfReader(BytesIO(replacement))
    if not repl.pages:
        raise ValueError("Yedek sayfa bos")
    total = len(orig.pages)
    idx = max(1, min(page_1based, total)) - 1
    writer = PdfWriter()
    for i, page in enumerate(orig.pages):
        writer.add_page(repl.pages[0] if i == idx else page)
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()
