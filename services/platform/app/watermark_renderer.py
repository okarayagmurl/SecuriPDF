"""PDF metin filigrani — sayfa merkezli, kesilmeden (PyMuPDF)."""

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
            cols = max(3, int(view.width / 140))
            rows = max(6, int(view.height / 72))
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
