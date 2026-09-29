"""PDF sayfasına görsel yerleştirme — tıklama noktası üst-sol kökenli, görsel merkezi."""

from __future__ import annotations

from io import BytesIO

import fitz


class ImagePlaceError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _image_point_size(image_bytes: bytes, scale_percent: float) -> tuple[bytes, float, float]:
    img = fitz.open(stream=image_bytes, filetype="image")
    try:
        pix = img[0].get_pixmap()
        xres = int(pix.xres or 0) or 96
        yres = int(pix.yres or 0) or 96
        scale = max(0.1, min(float(scale_percent), 200.0)) / 100.0
        width = max(4.0, pix.width * 72.0 / xres * scale)
        height = max(4.0, pix.height * 72.0 / yres * scale)
        return pix.tobytes("png"), width, height
    finally:
        img.close()


def place_image_on_pdf(
    pdf_bytes: bytes,
    image_bytes: bytes,
    *,
    x: float,
    y: float,
    page_number: int = 1,
    every_page: bool = False,
    scale_percent: float = 100.0,
) -> bytes:
    """x/y: sayfa üzerinde tıklanan nokta (pt), sol-üst köken, görselin merkezi."""
    if not pdf_bytes or pdf_bytes[:4] != b"%PDF":
        raise ImagePlaceError("INPUT_NOT_PDF")
    if not image_bytes:
        raise ImagePlaceError("INPUT_MISSING")

    png, width, height = _image_point_size(image_bytes, scale_percent)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        if doc.page_count < 1:
            raise ImagePlaceError("INPUT_NOT_PDF")
        if every_page:
            indexes = list(range(doc.page_count))
        else:
            index = max(1, int(page_number)) - 1
            if index >= doc.page_count:
                raise ImagePlaceError("PAGE_OUT_OF_RANGE")
            indexes = [index]

        for index in indexes:
            page = doc[index]
            pw, ph = float(page.rect.width), float(page.rect.height)
            dw, dh = width, height
            if dw > pw:
                dh *= pw / dw
                dw = pw
            if dh > ph:
                dw *= ph / dh
                dh = ph
            x0 = float(x) - dw / 2.0
            y0 = float(y) - dh / 2.0
            x0 = min(max(0.0, x0), max(0.0, pw - dw))
            y0 = min(max(0.0, y0), max(0.0, ph - dh))
            page.insert_image(fitz.Rect(x0, y0, x0 + dw, y0 + dh), stream=png)

        out = BytesIO()
        doc.save(out, deflate=True, garbage=4)
        return out.getvalue()
    finally:
        doc.close()
