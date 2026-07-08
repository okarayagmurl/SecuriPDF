from __future__ import annotations

from typing import Any

# Platform tarafinda islenir; Stirling'e gonderilmez (araca ozel).
_PLATFORM_ONLY_BY_TOOL: dict[str, frozenset[str]] = {
    "add-image": frozenset({"pageNumber", "imageScalePercent"}),
    "auto-redact": frozenset({"redactSelection", "redactPatternIds", "customRedactRegex"}),
    "compress-pdf": frozenset({"lineArt"}),
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
        fmt = out.get("outputFormat") or out.get("output_format") or "eps"
        out["outputFormat"] = str(fmt).lower()
        out.pop("output_format", None)

    if tool_id == "ebook-to-pdf":
        for key in ("embedAllFonts", "includeTableOfContents", "includePageNumbers", "optimizeForEbook"):
            out[key] = _as_bool_str(out.get(key, "false"))

    if tool_id == "sanitize-pdf":
        for key, default in _SANITIZE_DEFAULTS.items():
            out[key] = _as_bool_str(out.get(key, default))
        # removeFonts=true gömülyü siler; metin "bozuk karakter" gibi görünebilir — UI uyarısı var.

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
        if "password" not in out:
            out["password"] = ""


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

    _apply_tool_rules(tool_id, out)
    return out
