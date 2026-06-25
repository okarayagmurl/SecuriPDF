"""Filigran yerlesimi — Stirling WatermarkController ile uyumlu matematiksel model.

Stirling hucre boyutu:
  ww = widthSpacer + maxLineWidth * fontSize / 1000
  wh = heightSpacer + fontSize * lineCount
  nw = |ww*cos(r)| + |wh*sin(r)|
  nh = |ww*sin(r)| + |wh*cos(r)|
Konum: (j*nw, i*nh) — sol-alt kose, PDF koordinatlari.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from io import BytesIO

_GLYPH_WIDTH_ROMAN = 520
_TEXT_WIDTH_SAFETY = 1.22  # NotoSans gercek olcum > tahmin
_MIN_SPACER = 6
_MAX_SPACER = 4000
_PAGE_MARGIN = 0.08  # kenar boslugu (oran)
_A4 = (595.0, 842.0)

STYLE_ROTATION: dict[str, int | None] = {
    "tiled": 45,
    "diagonal": None,  # sayfa diyagonaline gore atan2
    "dense": 30,
    "quad": 52,
}

STYLE_FONT_RATIO: dict[str, float] = {
    "tiled": 0.038,
    "diagonal": 0.0,
    "dense": 0.022,
    "quad": 0.034,
}


@dataclass(frozen=True)
class PageSize:
    width: float
    height: float


@dataclass(frozen=True)
class WatermarkLayout:
    rotation: int
    width_spacer: int
    height_spacer: int
    font_size: int | None = None


def _effective_page_size(page) -> PageSize:
    w = float(page.mediabox.width)
    h = float(page.mediabox.height)
    rotation = int(page.get("/Rotate", 0) or 0) % 360
    if rotation in (90, 270):
        w, h = h, w
    return PageSize(w, h)


def pdf_reference_page_size(pdf_bytes: bytes) -> PageSize:
    """Tum sayfalar icinde en dar gorunur alan (pt) — kesilmeyi onler."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(pdf_bytes))
        if not reader.pages:
            return PageSize(*_A4)
        sizes = [_effective_page_size(p) for p in reader.pages]
        return PageSize(
            min(s.width for s in sizes),
            min(s.height for s in sizes),
        )
    except Exception:
        return PageSize(*_A4)


def _glyph_width_1000(char: str) -> int:
    o = ord(char)
    if char.isspace():
        return 280
    if o < 128:
        if char.isupper():
            return 620
        if char.isdigit():
            return 560
        if char in "-_.":
            return 340
        return _GLYPH_WIDTH_ROMAN
    return 680


def _text_width_1000(text: str) -> float:
    if not text:
        return float(_GLYPH_WIDTH_ROMAN)
    return float(sum(_glyph_width_1000(c) for c in text))


def text_width_pt(text: str, font_size: float) -> float:
    return _text_width_1000(text) * font_size / 1000.0 * _TEXT_WIDTH_SAFETY


def text_cell_dimensions(text: str, font_size: float, *, line_count: int = 1) -> tuple[float, float]:
    w = text_width_pt(text, font_size)
    h = font_size * line_count * 1.15
    return w, h


def stirling_tile_metrics(
    text_width_1000: float,
    font_size: float,
    width_spacer: float,
    height_spacer: float,
    rotation_deg: float,
    *,
    line_count: int = 1,
) -> tuple[float, float, float, float]:
    ww = width_spacer + text_width_1000 * font_size / 1000.0
    wh = height_spacer + font_size * line_count
    rad = math.radians(rotation_deg)
    c, s = abs(math.cos(rad)), abs(math.sin(rad))
    nw = ww * c + wh * s
    nh = ww * s + wh * c
    return nw, nh, ww, wh


def _diagonal_rotation(page: PageSize) -> int:
    return int(round(math.degrees(math.atan2(page.height, page.width))))


def _style_rotation(style_id: str, page: PageSize) -> int:
    spec = STYLE_ROTATION.get(style_id, 45)
    if spec is None:
        return _diagonal_rotation(page)
    return int(spec)


def _clamp_spacer(value: float, page_dim: float) -> int:
    upper = min(_MAX_SPACER, max(page_dim * 2.5, 200))
    return int(max(_MIN_SPACER, min(upper, round(value))))


def _parse_font_size(form_data: dict) -> float | None:
    raw = form_data.get("fontSize")
    if raw is None or str(raw).strip() == "":
        return None
    try:
        v = float(str(raw))
        return v if v > 0 else None
    except ValueError:
        return None


def _text_footprint_bounds(
    px: float,
    py: float,
    text_w: float,
    text_h: float,
    rotation_deg: float,
) -> tuple[float, float, float, float]:
    """Metin dikdortgeninin dondurulmus eksen-hizali sinir kutusu (PDF y yukari)."""
    ascent = text_h * 0.82
    descent = text_h * 0.18
    local = [
        (0.0, -descent),
        (text_w, -descent),
        (text_w, ascent),
        (0.0, ascent),
    ]
    rad = math.radians(rotation_deg)
    c, s = math.cos(rad), math.sin(rad)
    xs: list[float] = []
    ys: list[float] = []
    for x, y in local:
        xs.append(px + x * c - y * s)
        ys.append(py + x * s + y * c)
    return min(xs), min(ys), max(xs), max(ys)


def _footprint_inside_page(
    bounds: tuple[float, float, float, float],
    page: PageSize,
    *,
    margin_ratio: float = _PAGE_MARGIN,
) -> bool:
    min_x, min_y, max_x, max_y = bounds
    mx = page.width * margin_ratio
    my = page.height * margin_ratio
    return (
        min_x >= mx
        and min_y >= my
        and max_x <= page.width - mx
        and max_y <= page.height - my
    )


def _grid_counts(page: PageSize, nw: float, nh: float) -> tuple[int, int]:
    cols = min(int(page.width / nw + 1), 10_000)
    rows = min(int(page.height / nh + 1), 10_000)
    return cols, rows


def _layout_fits_page(
    page: PageSize,
    text: str,
    font_size: float,
    width_spacer: float,
    height_spacer: float,
    rotation_deg: float,
    *,
    line_count: int = 1,
) -> bool:
    tw, th = text_cell_dimensions(text, font_size, line_count=line_count)
    tw1000 = _text_width_1000(text) * _TEXT_WIDTH_SAFETY
    nw, nh, _, _ = stirling_tile_metrics(
        tw1000, font_size, width_spacer, height_spacer, rotation_deg, line_count=line_count
    )
    cols, rows = _grid_counts(page, nw, nh)
    for row in range(rows + 1):
        for col in range(cols + 1):
            px = col * nw
            py = row * nh
            bounds = _text_footprint_bounds(px, py, tw, th, rotation_deg)
            if not _footprint_inside_page(bounds, page):
                return False
    return True


def _max_font_binary(
    page: PageSize,
    text: str,
    rotation_deg: float,
    width_spacer: float,
    height_spacer: float,
    *,
    line_count: int = 1,
    hi: int = 120,
) -> int:
    lo = 6
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if _layout_fits_page(
            page, text, mid, width_spacer, height_spacer, rotation_deg, line_count=line_count
        ):
            lo = mid
        else:
            hi = mid - 1
    return max(6, lo)


def _max_font_along_diagonal(page: PageSize, text: str, rotation_deg: float) -> int:
    """Sayfa diyagonali boyunca sigacak ust sinir (hizli tahmin)."""
    diag = math.hypot(page.width, page.height)
    usable = diag * (1.0 - 2 * _PAGE_MARGIN)
    tw1000 = _text_width_1000(text) * _TEXT_WIDTH_SAFETY
    if tw1000 <= 0:
        return 24
    return max(6, int(usable * 1000.0 / tw1000))


def _single_tile_spacers(
    page: PageSize,
    text: str,
    font_size: float,
    rotation_deg: float,
) -> tuple[int, int]:
    tw1000 = _text_width_1000(text) * _TEXT_WIDTH_SAFETY
    tw, th = text_cell_dimensions(text, font_size)
    pad_w = max(16.0, page.width * 0.04)
    pad_h = max(16.0, page.height * 0.04)
    ws = page.width - tw + pad_w
    hs = page.height - th + pad_h
    # Tek karo: nw > pageW ve nh > pageH
    for _ in range(6):
        nw, nh, _, _ = stirling_tile_metrics(tw1000, font_size, ws, hs, rotation_deg)
        if nw >= page.width * 0.98 and nh >= page.height * 0.98:
            break
        ws += max(8.0, (page.width * 0.98 - nw) / max(abs(math.cos(math.radians(rotation_deg))), 0.25))
        hs += max(8.0, (page.height * 0.98 - nh) / max(abs(math.cos(math.radians(rotation_deg))), 0.25))
    return _clamp_spacer(ws, page.width), _clamp_spacer(hs, page.height)


def _resolve_font_size(
    style_id: str,
    text: str,
    page: PageSize,
    rotation: int,
    user_font: float | None,
    width_spacer: float,
    height_spacer: float,
    *,
    line_count: int = 1,
) -> int:
    if style_id == "diagonal":
        cap = _max_font_along_diagonal(page, text, rotation)
        fitted = _max_font_binary(
            page, text, rotation, width_spacer, height_spacer, line_count=line_count, hi=min(120, cap)
        )
        if user_font is None:
            return fitted
        return int(max(6, min(user_font, fitted)))

    short = min(page.width, page.height)
    ratio = STYLE_FONT_RATIO.get(style_id, 0.035)
    auto = max(8, min(72, round(short * ratio)))
    candidate = int(max(8, min(120, round(user_font)))) if user_font is not None else auto
    while candidate > 6 and not _layout_fits_page(
        page, text, candidate, width_spacer, height_spacer, rotation, line_count=line_count
    ):
        candidate -= 1
    return max(6, candidate)


def _grid_spacers(
    page: PageSize,
    text: str,
    font_size: float,
    rotation_deg: float,
    *,
    target_cols: float,
    target_rows: float,
    width_factor: float = 1.0,
    height_factor: float = 1.0,
) -> tuple[int, int]:
    tw, th = text_cell_dimensions(text, font_size)
    cell_w = page.width / max(target_cols, 1.5)
    cell_h = page.height / max(target_rows, 1.5)
    ws = _clamp_spacer((cell_w - tw) * width_factor, page.width)
    hs = _clamp_spacer((cell_h - th) * height_factor, page.height)
    return ws, hs


def compute_watermark_layout(
    style_id: str,
    page: PageSize,
    *,
    text: str = "",
    font_size: float | None = None,
    watermark_type: str = "text",
    line_count: int = 1,
) -> WatermarkLayout:
    style = style_id if style_id in STYLE_ROTATION else "tiled"
    rotation = _style_rotation(style, page)
    label = text.strip() if watermark_type == "text" else "IMG"
    if not label:
        label = "DOC"

    if style == "diagonal":
        ws, hs = _single_tile_spacers(page, label, font_size or 24, rotation)
        fs = _resolve_font_size(style, label, page, rotation, font_size, ws, hs, line_count=line_count)
        ws, hs = _single_tile_spacers(page, label, fs, rotation)
        if not _layout_fits_page(page, label, fs, ws, hs, rotation, line_count=line_count):
            fs = _max_font_binary(page, label, rotation, ws, hs, line_count=line_count)
    elif style == "dense":
        cols = max(10.0, page.width / 48.0)
        rows = max(12.0, page.height / 42.0)
        ws, hs = _grid_spacers(page, label, font_size or 16, rotation, target_cols=cols, target_rows=rows)
        fs = _resolve_font_size(style, label, page, rotation, font_size, ws, hs, line_count=line_count)
        ws, hs = _grid_spacers(page, label, fs, rotation, target_cols=cols, target_rows=rows)
    elif style == "quad":
        cols = max(2.5, page.width / max(page.width * 0.28, 120.0))
        rows = max(6.0, page.height / max(page.height * 0.11, 72.0))
        ws, hs = _grid_spacers(
            page,
            label,
            font_size or 26,
            rotation,
            target_cols=cols,
            target_rows=rows,
            width_factor=0.55,
            height_factor=1.0,
        )
        fs = _resolve_font_size(style, label, page, rotation, font_size, ws, hs, line_count=line_count)
        ws, hs = _grid_spacers(
            page, label, fs, rotation, target_cols=cols, target_rows=rows, width_factor=0.55, height_factor=1.0
        )
    else:
        cols = max(4.0, page.width / 130.0)
        rows = max(5.0, page.height / 110.0)
        ws, hs = _grid_spacers(page, label, font_size or 30, rotation, target_cols=cols, target_rows=rows)
        fs = _resolve_font_size(style, label, page, rotation, font_size, ws, hs, line_count=line_count)
        ws, hs = _grid_spacers(page, label, fs, rotation, target_cols=cols, target_rows=rows)

    return WatermarkLayout(rotation=rotation, width_spacer=ws, height_spacer=hs, font_size=fs)


def apply_watermark_layout(
    form_data: dict[str, str | list[str]],
    style_id: str | None,
    pdf_bytes: bytes,
) -> WatermarkLayout:
    page = pdf_reference_page_size(pdf_bytes)
    style = str(style_id or "tiled")
    wm_type = str(form_data.get("watermarkType", "text"))
    text = str(form_data.get("watermarkText", ""))
    user_font = _parse_font_size(form_data)

    layout = compute_watermark_layout(
        style,
        page,
        text=text,
        font_size=user_font,
        watermark_type=wm_type,
    )

    form_data["rotation"] = str(layout.rotation)
    form_data["widthSpacer"] = str(layout.width_spacer)
    form_data["heightSpacer"] = str(layout.height_spacer)
    if wm_type == "text" and layout.font_size is not None:
        form_data["fontSize"] = str(layout.font_size)

    return layout
