"""PDF otomatik karartma — tarama ve uygulama (PyMuPDF, Stirling gerektirmez)."""

from __future__ import annotations

import json
import re
from io import BytesIO
from typing import Any

import fitz

from .redaction_presets import expand_redaction_patterns, resolve_redaction_rules
from .redaction_text import (
    build_text_streams,
    extract_page_words,
    iter_pattern_matches,
    locate_match_rects,
)


class RedactionError(ValueError):
    """Karartma yapilamadi."""


def _parse_color(hex_color: str) -> tuple[float, float, float]:
    raw = str(hex_color or "#000000").strip().lstrip("#")
    if len(raw) == 6:
        return (
            int(raw[0:2], 16) / 255.0,
            int(raw[2:4], 16) / 255.0,
            int(raw[4:6], 16) / 255.0,
        )
    return (0.0, 0.0, 0.0)


def _make_match_id(page: int, rect: list[float], text: str) -> str:
    return f"p{page}-{round(rect[0], 1)}-{round(rect[1], 1)}-{round(rect[2], 1)}-{round(rect[3], 1)}-{hash(text) & 0xFFFFFF:x}"


def get_pdf_page_metadata(pdf_bytes: bytes) -> dict[str, Any]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages_out: list[dict[str, Any]] = []
    try:
        for index, page in enumerate(doc):
            pages_out.append(
                {
                    "page": index + 1,
                    "width": float(page.rect.width),
                    "height": float(page.rect.height),
                }
            )
    finally:
        doc.close()
    return {"pageCount": len(pages_out), "pages": pages_out}


def _pattern_flags(pattern_id: str) -> int:
    if pattern_id in ("address_tr", "passport"):
        return re.IGNORECASE
    return 0


def _stream_names_for_pattern(pattern_id: str) -> tuple[str, ...]:
    if pattern_id in ("mobile_tr", "phone_tr", "tckn", "vkn", "credit_card", "iban_tr", "postal_code_tr"):
        return ("collapsed", "digits_only", "loose")
    if pattern_id == "email":
        return ("collapsed", "loose")
    if pattern_id == "address_tr":
        return ("collapsed", "loose")
    return ("collapsed", "loose", "digits_only")


def _find_page_matches(
    page: fitz.Page,
    rules: list[dict[str, str]],
    *,
    max_matches: int,
) -> list[dict[str, Any]]:
    words = extract_page_words(page)
    if not words and not (page.get_text("text") or "").strip():
        return []

    streams = build_text_streams(page, words)
    if not streams["collapsed"].strip() and not streams["loose"].strip():
        return []

    found: list[dict[str, Any]] = []
    seen: set[tuple[float, float, float, float, str]] = set()
    seen_text: set[str] = set()

    for rule in rules:
        pattern_id = rule["id"]
        pattern = rule["regex"]
        flags = _pattern_flags(pattern_id)
        stream_names = _stream_names_for_pattern(pattern_id)

        for start, end, matched, stream_name in iter_pattern_matches(
            streams, pattern, stream_names=stream_names, flags=flags
        ):
            norm_key = re.sub(r"\s+", " ", matched.lower())
            if norm_key in seen_text:
                continue

            rects = locate_match_rects(page, words, streams, start, end, matched, stream_name)
            if not rects:
                continue

            for rect in rects:
                key = (round(rect.x0, 1), round(rect.y0, 1), round(rect.x1, 1), round(rect.y1, 1), matched)
                if key in seen:
                    continue
                seen.add(key)
                seen_text.add(norm_key)
                rect_list = [float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1)]
                found.append(
                    {
                        "text": matched,
                        "patternId": pattern_id,
                        "patternTitle": rule.get("title", pattern_id),
                        "rect": rect_list,
                    }
                )
                if len(found) >= max_matches:
                    return found
    return found


def scan_pdf_redactions(
    pdf_bytes: bytes,
    pattern_ids: list[str],
    custom_regex: str = "",
    *,
    max_per_page: int = 150,
) -> dict[str, Any]:
    rules = resolve_redaction_rules(pattern_ids, custom_regex)
    if not rules:
        raise RedactionError("En az bir desen gerekli")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages_out: list[dict[str, Any]] = []
    total = 0
    try:
        for index, page in enumerate(doc):
            page_num = index + 1
            matches = _find_page_matches(page, rules, max_matches=max_per_page)
            for item in matches:
                item["id"] = _make_match_id(page_num, item["rect"], item["text"])
            total += len(matches)
            pages_out.append(
                {
                    "page": index + 1,
                    "width": float(page.rect.width),
                    "height": float(page.rect.height),
                    "matches": matches,
                }
            )
    finally:
        doc.close()

    return {
        "totalMatches": total,
        "pageCount": len(pages_out),
        "pages": pages_out,
    }


def apply_pdf_redactions_by_areas(
    pdf_bytes: bytes,
    areas: list[dict[str, Any]],
    *,
    color_hex: str = "#000000",
    padding: float = 1.0,
    rasterize: bool = True,
) -> bytes:
    if not areas:
        raise RedactionError("Karartılacak alan seçilmedi")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    color = _parse_color(color_hex)
    pad = max(0.0, float(padding))
    redact_images = fitz.PDF_REDACT_IMAGE_PIXELS if rasterize else 0
    any_redaction = False

    by_page: dict[int, list[fitz.Rect]] = {}
    for item in areas:
        page_no = int(item.get("page") or 0)
        rect_raw = item.get("rect")
        if page_no < 1 or page_no > len(doc) or not rect_raw or len(rect_raw) < 4:
            continue
        rect = fitz.Rect(rect_raw[0], rect_raw[1], rect_raw[2], rect_raw[3])
        if rect.is_empty or rect.is_infinite:
            continue
        if pad:
            rect = rect + (-pad, -pad, pad, pad)
        by_page.setdefault(page_no, []).append(rect)

    if not by_page:
        doc.close()
        raise RedactionError("Geçerli karartma alanı bulunamadı")

    try:
        for page_no, rects in by_page.items():
            page = doc[page_no - 1]
            for rect in rects:
                page.add_redact_annot(rect, fill=color)
            page.apply_redactions(images=redact_images)
            any_redaction = True

        if not any_redaction:
            raise RedactionError("Karartma uygulanamadı")

        out = BytesIO()
        doc.save(out, deflate=True, garbage=4)
        return out.getvalue()
    finally:
        doc.close()


def apply_pdf_redactions(
    pdf_bytes: bytes,
    regexes: list[str],
    *,
    color_hex: str = "#000000",
    padding: float = 1.0,
    rasterize: bool = True,
    pattern_ids: list[str] | None = None,
) -> bytes:
    if not regexes:
        raise RedactionError("Karartma deseni yok")

    rules: list[dict[str, str]] = []
    if pattern_ids and len(pattern_ids) == len(regexes):
        for pid, rx in zip(pattern_ids, regexes, strict=False):
            rules.append({"id": pid, "regex": rx, "title": pid})
    else:
        for i, rx in enumerate(regexes):
            rules.append({"id": f"pattern_{i}", "regex": rx, "title": rx})

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    color = _parse_color(color_hex)
    pad = max(0.0, float(padding))
    redact_images = fitz.PDF_REDACT_IMAGE_PIXELS if rasterize else 0
    any_redaction = False

    try:
        for page in doc:
            matches = _find_page_matches(page, rules, max_matches=500)
            if not matches:
                continue
            page_any = False
            for item in matches:
                rect = fitz.Rect(item["rect"])
                if pad:
                    rect = rect + (-pad, -pad, pad, pad)
                page.add_redact_annot(rect, fill=color)
                page_any = True
            if page_any:
                page.apply_redactions(images=redact_images)
                any_redaction = True

        if not any_redaction:
            raise RedactionError(
                "Karartılacak metin bulunamadı. Taranmış belgelerde önce OCR uygulayın."
            )

        out = BytesIO()
        doc.save(out, deflate=True, garbage=4)
        return out.getvalue()
    finally:
        doc.close()


def apply_pdf_redactions_from_form(
    pdf_bytes: bytes,
    pattern_ids: list[str],
    custom_regex: str,
    form_data: dict[str, str | list[str]],
) -> bytes:
    rasterize = str(form_data.get("convertPDFToImage", "true")).lower() in ("true", "on", "1")
    padding_raw = form_data.get("customPadding", "1")
    try:
        padding = float(str(padding_raw)) if padding_raw not in (None, "") else 1.0
    except ValueError:
        padding = 1.0
    color = str(form_data.get("redactColor", "#000000"))

    selection_raw = form_data.get("redactSelection")
    if selection_raw:
        try:
            selection = json.loads(str(selection_raw))
            areas = selection.get("areas") if isinstance(selection, dict) else None
            if isinstance(areas, list) and areas:
                return apply_pdf_redactions_by_areas(
                    pdf_bytes,
                    areas,
                    color_hex=color,
                    padding=padding,
                    rasterize=rasterize,
                )
        except json.JSONDecodeError:
            pass

    rules = resolve_redaction_rules(pattern_ids, custom_regex)
    regexes = [r["regex"] for r in rules]
    ids = [r["id"] for r in rules]
    return apply_pdf_redactions(
        pdf_bytes,
        regexes,
        color_hex=color,
        padding=padding,
        rasterize=rasterize,
        pattern_ids=ids,
    )
