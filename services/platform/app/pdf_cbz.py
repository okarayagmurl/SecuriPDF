from __future__ import annotations

from io import BytesIO
from zipfile import ZipFile


class CbzError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}


def cbz_to_pdf(cbz_bytes: bytes) -> bytes:
    """CBZ (ZIP içi görseller) → PDF — Stirling yedek yolu."""
    import fitz

    if not cbz_bytes or cbz_bytes[:2] != b"PK":
        raise CbzError("CBZ_NOT_ZIP")

    try:
        zf = ZipFile(BytesIO(cbz_bytes))
    except Exception as exc:
        raise CbzError("CBZ_INVALID") from exc

    try:
        names = sorted(
            n
            for n in zf.namelist()
            if not n.endswith("/")
            and not n.split("/")[-1].startswith(".")
            and any(n.lower().endswith(ext) for ext in _IMAGE_EXTS)
        )
        if not names:
            raise CbzError("CBZ_NO_IMAGES")

        doc = fitz.open()
        try:
            for name in names:
                img_bytes = zf.read(name)
                try:
                    img = fitz.open(stream=img_bytes, filetype="image")
                except Exception:
                    continue
                try:
                    rect = img[0].rect
                    page = doc.new_page(width=rect.width, height=rect.height)
                    page.insert_image(page.rect, stream=img_bytes)
                finally:
                    img.close()
            if doc.page_count < 1:
                raise CbzError("CBZ_NO_IMAGES")
            out = BytesIO()
            doc.save(out, deflate=True)
            return out.getvalue()
        finally:
            doc.close()
    finally:
        zf.close()
