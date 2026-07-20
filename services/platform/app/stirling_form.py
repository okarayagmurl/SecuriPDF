from __future__ import annotations

from typing import Any

# Platform tarafinda islenir; Stirling'e gonderilmez (araca ozel).
_PLATFORM_ONLY_BY_TOOL: dict[str, frozenset[str]] = {
    "add-image": frozenset({"pageNumber", "imageScalePercent"}),
    "auto-redact": frozenset({"redactSelection", "redactPatternIds", "customRedactRegex"}),
}

# Stirling 2.x multipart boolean alanlari.
_BOOL_FIELDS = frozenset({
    "autoRotate",
    "combineImages",
    "combineIntoSinglePdf",
    "strict",
    "detectChapters",
    "includeAttachments",
    "downloadHtml",
    "includeAllRecipients",
    "optimizeForEbook",
    "embedAllFonts",
    "includeTableOfContents",
    "includePageNumbers",
    "everyPage",
    "convertPdfToImage",
    "convertPDFToImage",
    "linearize",
    "lineArt",
    "grayscale",
    "normalize",
    "removeJavaScript",
    "removeEmbeddedFiles",
    "removeXMPMetadata",
    "removeMetadata",
    "removeLinks",
    "removeFonts",
    "useFirstTextAsFallback",
    "showSignature",
    "showLogo",
    "flattenOnlyForms",
    "deleteAll",
    "replaceExisting",
    "allowDuplicates",
    "duplexMode",
    "yellowish",
    "prepress",
    "convertToPdfA3b",
})

_SANITIZE_DEFAULTS: dict[str, str] = {
    "removeJavaScript": "true",
    "removeEmbeddedFiles": "true",
    "removeXMPMetadata": "false",
    "removeMetadata": "false",
    "removeLinks": "false",
    "removeFonts": "false",
}


def _as_bool_str(value: Any) -> str:
    return "true" if str(value).lower() in {"true", "1", "on", "yes"} else "false"


def _drop_platform_fields(tool_id: str, out: dict[str, str | list[str]]) -> None:
    for key in _PLATFORM_ONLY_BY_TOOL.get(tool_id, frozenset()):
        out.pop(key, None)


def _apply_tool_rules(tool_id: str, out: dict[str, str | list[str]]) -> None:
    if tool_id == "vector-to-pdf":
        # Stirling Ghostscript vector→PDF yalnızca dosya uzantısına bakar;
        # OpenAPI PdfVectorExportRequest yanlışlıkla buraya bağlanmış — gerçek alan prepress.
        out.pop("inputFormat", None)
        out.pop("outputFormat", None)
        out.pop("output_format", None)
        if "prepress" not in out:
            out["prepress"] = "false"

    if tool_id == "pdf-to-vector":
        if "prepress" not in out:
            out["prepress"] = "false"
        fmt = str(out.get("outputFormat") or out.get("output_format") or "eps").lower()
        # EPS bazı Ghostscript kurulumlarında başarısız; PS daha güvenilir yedek değil —
        # kullanıcı seçimini koru ama formatı normalize et.
        if fmt not in {"eps", "ps", "pcl", "xps"}:
            fmt = "eps"
        out["outputFormat"] = fmt
        out.pop("output_format", None)
        # PDF dosyası uzantısı korunmalı (Stirling uzantıya da bakabilir).
        out.pop("inputFormat", None)
    if tool_id == "ebook-to-pdf":
        for key in ("embedAllFonts", "includeTableOfContents", "includePageNumbers", "optimizeForEbook"):
            out[key] = _as_bool_str(out.get(key, "false"))

    if tool_id == "sanitize-pdf":
        for key, default in _SANITIZE_DEFAULTS.items():
            out[key] = _as_bool_str(out.get(key, default))
        # Platform PyMuPDF yolu font silmez; bayrağı her zaman false bırak.
        out["removeFonts"] = "false"

    if tool_id in ("cbr-to-pdf", "cbz-to-pdf"):
        out["optimizeForEbook"] = _as_bool_str(out.get("optimizeForEbook", "false"))

    if tool_id == "url-to-pdf":
        for drop in ("fileInput", "tool_id", "toolId", "fileId"):
            out.pop(drop, None)
        url = str(out.get("urlInput") or "").strip()
        if url:
            out["urlInput"] = url

    if tool_id == "auto-split-pdf":
        out["duplexMode"] = _as_bool_str(out.get("duplexMode", "false"))

    if tool_id == "cert-sign":
        for key in ("showSignature", "showLogo"):
            out[key] = _as_bool_str(out.get(key, "false"))
        if "pageNumber" not in out or not str(out.get("pageNumber") or "").strip():
            out["pageNumber"] = "1"
        cert_type = str(out.get("certType") or "PKCS12").upper()
        if cert_type == "PFX":
            cert_type = "PKCS12"
        out["certType"] = cert_type
        # Stirling KeyStore.load(null password) NPE — her zaman string gönder.
        out["password"] = str(out.get("password") if out.get("password") is not None else "")
        for key in ("reason", "location", "name"):
            if key not in out:
                out[key] = ""


def encode_stirling_multipart(
    form_data: dict[str, Any],
    files: list[tuple[str, tuple[str | None, bytes, str | None]]],
) -> list[tuple[str, tuple[str | None, bytes | str, str | None]]]:
    """Tek multipart gövde — dosyasız isteklerde (url-to-pdf) urlencoded'a düşmez.

    httpx `files=[]` + `data={...}` application/x-www-form-urlencoded üretir;
    Stirling multipart bekler (415). Alanlar `(None, value)`, dosyalar `(name, bytes, ctype)`.
    """
    parts: list[tuple[str, tuple[str | None, bytes | str, str | None]]] = []
    for field, (filename, content, content_type) in files:
        parts.append(
            (
                field,
                (
                    filename or "input.bin",
                    content,
                    content_type or "application/octet-stream",
                ),
            )
        )
    for key, value in (form_data or {}).items():
        if isinstance(value, list):
            for item in value:
                parts.append((key, (None, str(item))))
        elif value is not None:
            parts.append((key, (None, str(value))))
    return parts


def normalize_stirling_form(tool_id: str, form_data: dict[str, Any]) -> dict[str, str | list[str]]:
    """Stirling 2.x multipart alanlari camelCase bekler."""
    out: dict[str, str | list[str]] = {}
    for key, value in (form_data or {}).items():
        if value is None:
            continue
        if isinstance(value, list):
            out[key] = [str(item) for item in value]
        else:
            out[key] = str(value)

    _drop_platform_fields(tool_id, out)

    for key in _BOOL_FIELDS:
        if key in out:
            out[key] = _as_bool_str(out[key])

    if tool_id == "compress-pdf":
        target_size = (out.get("expectedOutputSize") or "").strip()
        if target_size:
            out.pop("optimizeLevel", None)
        else:
            out.pop("expectedOutputSize", None)
        for key in ("lineArt", "linearize", "grayscale"):
            if key in out:
                out[key] = _as_bool_str(out[key])

    if tool_id == "replace-invert-pdf":
        for color_key in ("backGroundColor", "textColor"):
            raw = str(out.get(color_key) or "").strip()
            if not raw:
                continue
            out[color_key] = _hex_color_to_decimal(raw)

    if tool_id == "scanner-effect":
        if "rotation" not in out or not str(out.get("rotation") or "").strip():
            out["rotation"] = "slight"
        # Yüksek kalite bazı Stirling/Ghostscript kurulumlarında OOM veya 500 verir.
        quality = str(out.get("quality") or "medium").strip().lower() or "medium"
        if quality == "high":
            quality = "medium"
        out["quality"] = quality
        if "yellowish" in out:
            out["yellowish"] = _as_bool_str(out["yellowish"])
        # Gelişmiş DPI alanlarını güvenli tut — boş/çok yüksek değer motor hatası.
        for drop in ("advanced_enabled", "advancedEnabled", "resolution", "dpi"):
            out.pop(drop, None)
    if tool_id == "edit-table-of-contents":
        raw = str(out.get("bookmarkData") or "").strip()
        if raw:
            out["bookmarkData"] = _normalize_bookmark_json(raw)

    if tool_id == "scale-pages":
        if "pageSize" not in out or not str(out.get("pageSize") or "").strip():
            out["pageSize"] = "A4"
        sf = str(out.get("scaleFactor") or "").strip().replace(",", ".")
        try:
            val = float(sf) if sf else 1.0
        except ValueError:
            val = 1.0
        if val <= 0:
            val = 1.0
        out["scaleFactor"] = str(val)

    _apply_tool_rules(tool_id, out)
    return out


def _hex_color_to_decimal(value: str) -> str:
    """Stirling CUSTOM_COLOR 24-bit decimal bekler (#RRGGBB veya rgb)."""
    text = value.strip()
    if text.isdigit():
        return text
    if text.startswith("#"):
        text = text[1:]
    if len(text) == 3 and all(c in "0123456789abcdefABCDEF" for c in text):
        text = "".join(c * 2 for c in text)
    if len(text) == 6 and all(c in "0123456789abcdefABCDEF" for c in text):
        return str(int(text, 16))
    return value


def _normalize_bookmark_json(raw: str) -> str:
    import json

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if not isinstance(data, list):
        return raw

    def fix_node(node: Any) -> Any:
        if not isinstance(node, dict):
            return node
        out = dict(node)
        if "pageNumber" not in out and "page" in out:
            out["pageNumber"] = out.pop("page")
        try:
            out["pageNumber"] = max(1, int(float(str(out.get("pageNumber", 1)))))
        except (TypeError, ValueError):
            out["pageNumber"] = 1
        children = out.get("children")
        if isinstance(children, list):
            out["children"] = [fix_node(c) for c in children]
        return out

    return json.dumps([fix_node(n) for n in data], ensure_ascii=False)
