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
        fmt = out.pop("outputFormat", None) or out.pop("output_format", None)
        if fmt:
            out["inputFormat"] = str(fmt)

    if tool_id == "sanitize-pdf":
        for key, default in _SANITIZE_DEFAULTS.items():
            out[key] = _as_bool_str(out.get(key, default))

    if tool_id == "url-to-pdf":
        for drop in ("fileInput", "tool_id", "toolId"):
            out.pop(drop, None)


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
