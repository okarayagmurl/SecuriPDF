"""PDF yer imi / içindekiler düzenleme (platform PyMuPDF)."""

from __future__ import annotations

import json
from typing import Any


class TocError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _as_int(value: Any, default: int = 1) -> int:
    try:
        n = int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default
    return max(1, n)


def _normalize_nodes(raw: Any, *, require_items: bool = True) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise TocError("TOC_INVALID_JSON")
    out: list[dict[str, Any]] = []
    for node in raw:
        if not isinstance(node, dict):
            continue
        title = str(node.get("title") or "").strip()
        if not title:
            continue
        page = node.get("pageNumber", node.get("page", 1))
        children = node.get("children") or []
        item = {
            "title": title,
            "pageNumber": _as_int(page, 1),
            "children": _normalize_nodes(children, require_items=False) if isinstance(children, list) else [],
        }
        out.append(item)
    if require_items and not out:
        raise TocError("TOC_EMPTY")
    return out


def parse_bookmark_data(raw: str | list | dict) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return _normalize_nodes(raw)
    text = str(raw or "").strip()
    if not text:
        raise TocError("TOC_INVALID_JSON")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise TocError("TOC_INVALID_JSON") from exc
    return _normalize_nodes(data)


def apply_toc(pdf_bytes: bytes, bookmark_data: str | list | dict, *, replace_existing: bool = True) -> bytes:
    import fitz

    nodes = parse_bookmark_data(bookmark_data)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page_count = doc.page_count
        if page_count < 1:
            raise TocError("TOC_EMPTY_PDF")

        def clamp_page(n: int) -> int:
            return min(max(1, n), page_count)

        def to_toc(items: list[dict[str, Any]], level: int = 1) -> list[list]:
            rows: list[list] = []
            for item in items:
                page = clamp_page(int(item["pageNumber"]))
                rows.append([level, str(item["title"]), page])
                rows.extend(to_toc(item.get("children") or [], level + 1))
            return rows

        toc_rows = to_toc(nodes)
        if replace_existing:
            doc.set_toc([])
        doc.set_toc(toc_rows)
        if not doc.get_toc():
            raise TocError("TOC_APPLY_FAILED")
        return doc.tobytes()
    finally:
        doc.close()
