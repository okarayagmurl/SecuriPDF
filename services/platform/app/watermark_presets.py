"""Filigran metin bicimlendirme — yerlesim watermark_layout modulunde."""

from __future__ import annotations

from .watermark_layout import STYLE_ROTATION, apply_watermark_layout

# Geriye uyumluluk
WATERMARK_STYLE_PRESETS: dict[str, dict[str, int | float]] = {
    style_id: {
        "rotation": STYLE_ROTATION[style_id],
        "fontSize": 30 if style_id != "dense" else 16,
    }
    for style_id in STYLE_ROTATION
}


def apply_watermark_style(
    form_data: dict[str, str | list[str]],
    style_id: str | None,
    pdf_bytes: bytes | None = None,
) -> None:
    if pdf_bytes:
        apply_watermark_layout(form_data, style_id, pdf_bytes)


def format_watermark_with_document_number(base_text: str, document_id: str) -> str:
    """Stirling tek satir metin destekler; satir sonu (\\n) 400 hatasi verir."""
    base = base_text.strip()
    if base:
        return f"{base} · {document_id}"
    return document_id
