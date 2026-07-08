"""PDF metin/gorsel filigrani — sayfa merkezli, kesilmeden (PyMuPDF)."""

from __future__ import annotations

import math
from io import BytesIO

import fitz

from .watermark_layout import PageSize, compute_watermark_layout, pdf_reference_page_size, text_width_pt


def _parse_color(hex_color: str) -> tuple[float, float, float]:
    raw = str(hex_color or "#d3d3d3").strip().lstrip("#")
    if len(raw) == 6:
        return (
            int(raw[0:2], 16) / 255.0,
            int(raw[2:4], 16) / 255.0,
            int(raw[4:6], 16) / 255.0,
        )
    return (0.83, 0.83, 0.83)


def _page_view_size(page: fitz.Page) -> PageSize:
    r = page.rect
    return PageSize(float(r.width), float(r.height))


def _fit_font_in_box(
    box_w: float,
    box_h: float,
    text: str,
    rotation: float,
    *,
    margin: float = 0.88,
) -> float:
    lo, hi = 6.0, 120.0
    limit_w, limit_h = box_w * margin, box_h * margin
    while hi - lo > 0.25:
        mid = (lo + hi) / 2.0
        tw = text_width_pt(text, mid)
        th = mid * 1.1
        rad = math.radians(rotation)
        bw = abs(tw * math.cos(rad)) + abs(th * math.sin(rad))
        bh = abs(tw * math.sin(rad)) + abs(th * math.cos(rad))
        if bw <= limit_w and bh <= limit_h:
            lo = mid
        else:
            hi = mid
    return max(6.0, lo)


def _insert_centered_text(
    page: fitz.Page,
    text: str,
    *,
    font_size: float,
    rotation: float,
    opacity: float,
    color: tuple[float, float, float],
) -> None:
    rect = page.rect
    cx, cy = rect.width / 2.0, rect.height / 2.0
    tw = text_width_pt(text, font_size)
    th = font_size
    rad = math.radians(rotation)
    dx = (tw / 2.0) * math.cos(rad) - (th / 2.0) * math.sin(rad)
    dy = (tw / 2.0) * math.sin(rad) + (th / 2.0) * math.cos(rad)
    origin = fitz.Point(cx - dx, cy - dy)
    pivot = fitz.Point(cx, cy)
    morph = (pivot, fitz.Matrix(rotation))
    page.insert_text(
        origin,
        text,
        fontsize=font_size,
        color=color,
        overlay=True,
        fill_opacity=opacity,
        morph=morph,
    )


def _insert_grid_text(
    page: fitz.Page,
    text: str,
    *,
    font_size: float,
    rotation: float,
    opacity: float,
    color: tuple[float, float, float],
    cols: int,
    rows: int,
) -> None:
    rect = page.rect
    cell_w = rect.width / max(cols, 1)
    cell_h = rect.height / max(rows, 1)
    cell_fs = _fit_font_in_box(cell_w, cell_h, text, rotation)
    fs = min(font_size, cell_fs)
    tw = text_width_pt(text, fs)
    th = fs
    rad = math.radians(rotation)
    for row in range(rows):
        for col in range(cols):
            cx = col * cell_w + cell_w / 2.0
            cy = rect.height - (row + 0.5) * cell_h
            dx = (tw / 2.0) * math.cos(rad) - (th / 2.0) * math.sin(rad)
            dy = (tw / 2.0) * math.sin(rad) + (th / 2.0) * math.cos(rad)
            origin = fitz.Point(cx - dx, cy - dy)
            pivot = fitz.Point(cx, cy)
            page.insert_text(
                origin,
                text,
                fontsize=fs,
                color=color,
                overlay=True,
                fill_opacity=opacity,
                morph=(pivot, fitz.Matrix(rotation)),
            )


def apply_text_watermark(
    pdf_bytes: bytes,
    *,
    text: str,
    style_id: str,
    font_size: float | None,
    opacity: float,
    color_hex: str,
) -> bytes:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    ref_page = pdf_reference_page_size(pdf_bytes)
    layout = compute_watermark_layout(
        style_id,
        ref_page,
        text=text,
        font_size=font_size,
        watermark_type="text",
    )
    rotation = float(layout.rotation)
    base_fs = float(layout.font_size or font_size or 24)
    color = _parse_color(color_hex)

    for page in doc:
        view = _page_view_size(page)
        if style_id == "diagonal":
            fs = _fit_font_in_box(view.width, view.height, text, rotation)
            _insert_centered_text(
                page, text, font_size=fs, rotation=rotation, opacity=opacity, color=color
            )
        elif style_id == "dense":
            cols = max(6, int(view.width / 72))
            rows = max(8, int(view.height / 52))
            _insert_grid_text(
                page, text, font_size=base_fs, rotation=rotation, opacity=opacity, color=color,
                cols=cols, rows=rows,
            )
        elif style_id == "quad":
            cols = max(2, int(view.width / 200))
            rows = max(3, int(view.height / 120))
            _insert_grid_text(
                page, text, font_size=base_fs, rotation=rotation, opacity=opacity, color=color,
                cols=cols, rows=rows,
            )
        else:
            cols = max(4, int(view.width / 130))
            rows = max(5, int(view.height / 110))
            _insert_grid_text(
                page, text, font_size=base_fs, rotation=rotation, opacity=opacity, color=color,
                cols=cols, rows=rows,
            )

    out = BytesIO()
    doc.save(out, deflate=True, garbage=4)
    doc.close()
    return out.getvalue()


def _fit_image_rect(
    page_rect: fitz.Rect,
    img_w: float,
    img_h: float,
    *,
    max_frac: float = 0.55,
) -> fitz.Rect:
    """Görseli sayfa ortasına, uzun kenarı max_frac ile sınırlayarak yerleştir."""
    if img_w <= 0 or img_h <= 0:
        img_w, img_h = 100.0, 100.0
    max_w = page_rect.width * max_frac
    max_h = page_rect.height * max_frac
    scale = min(max_w / img_w, max_h / img_h, 1.0)
    tw, th = img_w * scale, img_h * scale
    cx = (page_rect.x0 + page_rect.x1) / 2.0
    cy = (page_rect.y0 + page_rect.y1) / 2.0
    return fitz.Rect(cx - tw / 2.0, cy - th / 2.0, cx + tw / 2.0, cy + th / 2.0)


def apply_image_watermark(
    pdf_bytes: bytes,
    image_bytes: bytes,
    *,
    style_id: str,
    opacity: float,
    image_name: str | None = None,
) -> bytes:
    """Stirling image filigranı yerine platform PyMuPDF — 500 crash ve alan hatalarını önler."""
    del image_name  # API uyumu; içerik bytes üzerinden
    opacity = max(0.05, min(float(opacity), 1.0))
    style = style_id if style_id in ("tiled", "diagonal", "dense", "quad") else "tiled"
    alpha_byte = int(round(opacity * 255))

    img_doc = fitz.open(stream=image_bytes, filetype="image")
    try:
        base = img_doc[0].get_pixmap()
        pix = fitz.Pixmap(base) if base.alpha else fitz.Pixmap(base, 1)
        pix.set_alpha(bytes([alpha_byte]) * (pix.width * pix.height))
        iw, ih = float(pix.width), float(pix.height)
    finally:
        img_doc.close()

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for page in doc:
            rect = page.rect
            if style == "diagonal":
                box = _fit_image_rect(rect, iw, ih, max_frac=0.7)
                page.insert_image(box, pixmap=pix, overlay=True)
            else:
                if style == "dense":
                    cols, rows = max(4, int(rect.width / 160)), max(5, int(rect.height / 140))
                elif style == "quad":
                    cols, rows = max(2, int(rect.width / 240)), max(3, int(rect.height / 180))
                else:
                    cols, rows = max(3, int(rect.width / 200)), max(4, int(rect.height / 160))
                cell_w = rect.width / cols
                cell_h = rect.height / rows
                for row in range(rows):
                    for col in range(cols):
                        cx = rect.x0 + (col + 0.5) * cell_w
                        cy = rect.y0 + (row + 0.5) * cell_h
                        frac = 0.42 if style == "dense" else 0.55
                        max_w = cell_w * frac
                        max_h = cell_h * frac
                        scale = min(max_w / iw, max_h / ih, 1.0)
                        tw, th = iw * scale, ih * scale
                        box = fitz.Rect(cx - tw / 2.0, cy - th / 2.0, cx + tw / 2.0, cy + th / 2.0)
                        page.insert_image(box, pixmap=pix, overlay=True)

        out = BytesIO()
        doc.save(out, deflate=True, garbage=4)
        return out.getvalue()
    finally:
        doc.close()
