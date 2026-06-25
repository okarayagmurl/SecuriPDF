"""PDF metin akisi — satir kirilmalarinda dogru eslestirme icin kelime haritasi."""

from __future__ import annotations

import re
from typing import Any

import fitz

_WS = re.compile(r"\s+")


def _union_rects(rects: list[fitz.Rect]) -> fitz.Rect | None:
    if not rects:
        return None
    out = fitz.Rect(rects[0])
    for rect in rects[1:]:
        out |= rect
    return out


def extract_page_words(page: fitz.Page) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for item in page.get_text("words") or []:
        text = str(item[4]).strip()
        if not text:
            continue
        words.append(
            {
                "text": text,
                "bbox": fitz.Rect(item[0], item[1], item[2], item[3]),
                "block": int(item[5]),
                "line": int(item[6]),
            }
        )
    return words


def build_text_streams(page: fitz.Page, words: list[dict[str, Any]]) -> dict[str, Any]:
    """collapsed: tum kelimeler boslukla — e-posta/telefon satir kirilimlarini birlestirir."""
    collapsed_parts: list[str] = []
    char_word: list[int] = []

    for wi, word in enumerate(words):
        if collapsed_parts:
            collapsed_parts.append(" ")
            char_word.append(-1)
        for ch in word["text"]:
            collapsed_parts.append(ch)
            char_word.append(wi)

    collapsed = "".join(collapsed_parts)
    raw = page.get_text("text") or ""
    loose = _WS.sub(" ", raw).strip()
    # rakamlar arasindaki bosluklari kaldir; alan kodu parantezlerini temizle
    digits_only = re.sub(r"(?<=\d)\s+(?=\d)", "", collapsed)
    digits_only = re.sub(r"[()]", "", digits_only)

    return {
        "collapsed": collapsed,
        "loose": loose,
        "digits_only": digits_only,
        "char_word": char_word,
    }


def rects_for_span(
    words: list[dict[str, Any]],
    char_word: list[int],
    start: int,
    end: int,
) -> tuple[list[fitz.Rect], str]:
    if start < 0 or end <= start:
        return [], ""
    idxs = {char_word[i] for i in range(start, min(end, len(char_word))) if char_word[i] >= 0}
    if not idxs:
        return [], ""
    rects = [words[i]["bbox"] for i in sorted(idxs)]
    matched = "".join(
        words[i]["text"] + (" " if j < len(sorted(idxs)) - 1 else "")
        for j, i in enumerate(sorted(idxs))
    )
    return rects, matched.strip()


def _prune_overlapping_hits(
    hits: list[tuple[int, int, str, str]],
) -> list[tuple[int, int, str, str]]:
    """Ayni bolgedeki kisa eslesmeleri (or. kirpik e-posta) uzun olanla degistir."""
    if not hits:
        return hits
    ordered = sorted(hits, key=lambda h: (h[0], -(h[1] - h[0])))
    kept: list[tuple[int, int, str, str]] = []
    for hit in ordered:
        s, e, txt, sn = hit
        replaced = False
        for i, (ks, ke, ktxt, ksn) in enumerate(kept):
            if s >= ks and e <= ke:
                replaced = True
                break
            if ks >= s and ke <= e:
                kept[i] = hit
                replaced = True
                break
            if not (e <= ks or s >= ke):
                if (e - s) > (ke - ks):
                    kept[i] = hit
                replaced = True
                break
        if not replaced:
            kept.append(hit)
    return kept


def iter_pattern_matches(
    streams: dict[str, Any],
    pattern: str,
    *,
    stream_names: tuple[str, ...] = ("collapsed", "loose", "digits_only"),
    flags: int = 0,
) -> list[tuple[int, int, str, str]]:
    """(start, end, matched_text, stream_name) — cakisan araliklar birlestirilir."""
    try:
        compiled = re.compile(pattern, flags)
    except re.error:
        return []

    hits: list[tuple[int, int, str, str]] = []
    for stream_name in stream_names:
        text = streams.get(stream_name) or ""
        if not text:
            continue
        char_word = streams["char_word"] if stream_name == "collapsed" else []
        for match in compiled.finditer(text):
            start, end = match.start(), match.end()
            matched = match.group().strip()
            if not matched or len(matched) > 320:
                continue
            if stream_name == "collapsed" and char_word:
                hits.append((start, end, matched, stream_name))
            elif stream_name == "digits_only":
                hits.append((-1, -1, matched, stream_name))
            else:
                hits.append((-1, -1, matched, stream_name))

    if not hits:
        return []

    collapsed_hits = _prune_overlapping_hits([h for h in hits if h[0] >= 0])
    other = [h for h in hits if h[0] < 0]
    return collapsed_hits + other


def locate_match_rects(
    page: fitz.Page,
    words: list[dict[str, Any]],
    streams: dict[str, Any],
    start: int,
    end: int,
    matched_text: str,
    stream_name: str,
) -> list[fitz.Rect]:
    if stream_name == "collapsed" and words:
        rects, _ = rects_for_span(words, streams["char_word"], start, end)
        if rects:
            return rects

    query = matched_text.strip()
    if not query:
        return []

    # Tam metin ara
    try:
        found = page.search_for(query, quads=False)
        if found:
            return list(found)
    except Exception:
        pass

    # Satir kirik e-posta / adres: kelime kelime ara ve birlestir
    tokens = query.split()
    if len(tokens) >= 2:
        rect_sets: list[fitz.Rect] = []
        for token in tokens:
            if len(token) < 2:
                continue
            try:
                partial = page.search_for(token, quads=False)
            except Exception:
                partial = []
            if partial:
                rect_sets.extend(partial)
        if rect_sets:
            # yakin dikdortgenleri grupla (aynı satir)
            return _merge_near_rects(rect_sets)

    # Son care: bosluksuz telefon / ulke kodu (parantezli alan kodu dahil)
    compact = re.sub(r"[\s.\-\(\)]", "", query)
    if len(compact) >= 8:
        try:
            found = page.search_for(compact, quads=False)
            if found:
                return list(found)
        except Exception:
            pass
        if compact.startswith("90") and len(compact) >= 12:
            try:
                found = page.search_for(compact[2:], quads=False)
                if found:
                    return list(found)
            except Exception:
                pass

    return []


def _merge_near_rects(rects: list[fitz.Rect], *, y_tol: float = 4.0, x_gap: float = 40.0) -> list[fitz.Rect]:
    if not rects:
        return []
    sorted_r = sorted(rects, key=lambda r: (r.y0, r.x0))
    groups: list[list[fitz.Rect]] = [[sorted_r[0]]]
    for rect in sorted_r[1:]:
        prev = groups[-1][-1]
        same_line = abs(rect.y0 - prev.y0) <= y_tol
        close = rect.x0 - prev.x1 <= x_gap
        if same_line and close:
            groups[-1].append(rect)
        else:
            groups.append([rect])
    out: list[fitz.Rect] = []
    for group in groups:
        u = _union_rects(group)
        if u:
            out.append(u)
    return out
