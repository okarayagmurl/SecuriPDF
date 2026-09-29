"""PDF gömülü görsellerini ZIP olarak çıkarır."""

from __future__ import annotations

from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import fitz


class ImageExtractError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _as_format(image_bytes: bytes, ext: str, target: str) -> tuple[bytes, str]:
    target = (target or "png").lower()
    if target in {"jpg", "jpeg"}:
        target = "jpeg"
    if target not in {"png", "jpeg", "gif"}:
        target = "png"
    src_ext = (ext or "").lower()
    if target == "jpeg" and src_ext in {"jpg", "jpeg"}:
        return image_bytes, "jpg"
    if target == "png" and src_ext == "png":
        return image_bytes, "png"
    if target == "gif" and src_ext == "gif":
        return image_bytes, "gif"
    pix = fitz.Pixmap(image_bytes)
    try:
        if pix.n > 4:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        if target == "jpeg":
            return pix.tobytes("jpeg"), "jpg"
        if target == "gif":
            return pix.tobytes("png"), "png"
        return pix.tobytes("png"), "png"
    finally:
        pix = None


def extract_pdf_images(pdf_bytes: bytes, image_format: str = "png") -> bytes:
    if not pdf_bytes or pdf_bytes[:4] != b"%PDF":
        raise ImageExtractError("INPUT_NOT_PDF")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        seen: set[int] = set()
        entries: list[tuple[str, bytes]] = []
        for page in doc:
            for img in page.get_images(full=True) or []:
                xref = int(img[0])
                if xref in seen:
                    continue
                seen.add(xref)
                info = doc.extract_image(xref) or {}
                raw = info.get("image")
                if not raw:
                    continue
                data, ext = _as_format(raw, str(info.get("ext") or "png"), image_format)
                entries.append((f"gorsel-{len(entries) + 1}.{ext}", data))
        if not entries:
            raise ImageExtractError("EXTRACT_EMPTY")
        buf = BytesIO()
        with ZipFile(buf, "w", compression=ZIP_DEFLATED) as zf:
            for name, data in entries:
                zf.writestr(name, data)
        return buf.getvalue()
    finally:
        doc.close()
