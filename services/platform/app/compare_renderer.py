"""PDF metin karsilastirma — HTML rapor (PyMuPDF)."""

from __future__ import annotations

import difflib
import html
import re
from datetime import datetime, timezone

import fitz


class CompareError(ValueError):
    """Karsilastirma yapilamadi."""


def _normalize_color(value: str, default: str) -> str:
    raw = str(value or default).strip()
    if not raw.startswith("#"):
        raw = f"#{raw}"
    if re.fullmatch(r"#[0-9A-Fa-f]{6}", raw):
        return raw
    return default


def _page_texts(pdf_bytes: bytes) -> list[str]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return [page.get_text("text").strip() for page in doc]
    finally:
        doc.close()


def _highlight_pair(
    left: str,
    right: str,
    color_left: str,
    color_right: str,
) -> tuple[str, str]:
    if left == right:
        esc = html.escape(left)
        return esc, esc

    left_words = left.split()
    right_words = right.split()
    if not left_words and not right_words:
        return "", ""

    matcher = difflib.SequenceMatcher(None, left_words, right_words)
    left_parts: list[str] = []
    right_parts: list[str] = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        lw = " ".join(left_words[i1:i2])
        rw = " ".join(right_words[j1:j2])
        if tag == "equal":
            if lw:
                left_parts.append(html.escape(lw))
            if rw:
                right_parts.append(html.escape(rw))
        elif tag == "delete":
            if lw:
                left_parts.append(
                    f'<mark style="background:{color_left};padding:0 2px">{html.escape(lw)}</mark>'
                )
        elif tag == "insert":
            if rw:
                right_parts.append(
                    f'<mark style="background:{color_right};padding:0 2px">{html.escape(rw)}</mark>'
                )
        elif tag == "replace":
            if lw:
                left_parts.append(
                    f'<mark style="background:{color_left};padding:0 2px">{html.escape(lw)}</mark>'
                )
            if rw:
                right_parts.append(
                    f'<mark style="background:{color_right};padding:0 2px">{html.escape(rw)}</mark>'
                )

    return " ".join(left_parts), " ".join(right_parts)


def compare_pdfs_to_html(
    pdf_a: bytes,
    pdf_b: bytes,
    *,
    name_a: str = "Belge 1",
    name_b: str = "Belge 2",
    color_a: str = "#ffcccc",
    color_b: str = "#ccffcc",
) -> bytes:
    pages_a = _page_texts(pdf_a)
    pages_b = _page_texts(pdf_b)
    if not any(pages_a) and not any(pages_b):
        raise CompareError("Seçilen PDF'lerde metin bulunamadı. Taranmış belgeler için önce OCR uygulayın.")

    color_a = _normalize_color(color_a, "#ffcccc")
    color_b = _normalize_color(color_b, "#ccffcc")
    max_pages = max(len(pages_a), len(pages_b), 1)
    sections: list[str] = []

    for idx in range(max_pages):
        text_a = pages_a[idx] if idx < len(pages_a) else ""
        text_b = pages_b[idx] if idx < len(pages_b) else ""
        hl_a, hl_b = _highlight_pair(text_a, text_b, color_a, color_b)
        if not hl_a and not hl_b:
            hl_a = '<span class="muted">(boş sayfa)</span>'
            hl_b = '<span class="muted">(boş sayfa)</span>'
        sections.append(
            f'<section class="compare-page">'
            f'<h2>Sayfa {idx + 1}</h2>'
            f'<div class="compare-grid">'
            f'<div class="compare-panel"><h3>{html.escape(name_a)}</h3><div class="compare-text">{hl_a}</div></div>'
            f'<div class="compare-panel"><h3>{html.escape(name_b)}</h3><div class="compare-text">{hl_b}</div></div>'
            f"</div></section>"
        )

    generated = datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M UTC")
    doc = f"""<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF Karşılaştırma</title>
<style>
body {{ font-family: "Segoe UI", system-ui, sans-serif; margin: 0; padding: 1.5rem; background: #f8fafc; color: #0f172a; }}
h1 {{ margin: 0 0 0.25rem; font-size: 1.5rem; }}
.meta {{ color: #64748b; font-size: 0.9rem; margin-bottom: 1.25rem; }}
.legend {{ display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; font-size: 0.88rem; }}
.legend span {{ padding: 0.2rem 0.5rem; border-radius: 4px; }}
.compare-page {{ margin-bottom: 2rem; }}
.compare-page h2 {{ font-size: 1.1rem; margin: 0 0 0.75rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.35rem; }}
.compare-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }}
@media (max-width: 900px) {{ .compare-grid {{ grid-template-columns: 1fr; }} }}
.compare-panel {{ background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; }}
.compare-panel h3 {{ margin: 0 0 0.75rem; font-size: 0.95rem; color: #334155; }}
.compare-text {{ white-space: pre-wrap; word-break: break-word; line-height: 1.55; font-size: 0.92rem; }}
.muted {{ color: #94a3b8; font-style: italic; }}
mark {{ border-radius: 2px; }}
</style>
</head>
<body>
<h1>PDF Karşılaştırma</h1>
<p class="meta">{html.escape(name_a)} ↔ {html.escape(name_b)} · {generated}</p>
<div class="legend">
  <span style="background:{color_a}">Yalnızca belge 1</span>
  <span style="background:{color_b}">Yalnızca belge 2</span>
</div>
{"".join(sections)}
</body>
</html>"""
    return doc.encode("utf-8")
