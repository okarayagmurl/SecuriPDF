from __future__ import annotations

import re
from typing import Any


def _camel_to_snake(name: str) -> str:
    if "_" in name or name.islower():
        return name
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def _as_bool_str(value: Any) -> str:
    return "true" if str(value).lower() in {"true", "1", "on", "yes"} else "false"


def normalize_stirling_form(tool_id: str, form_data: dict[str, Any]) -> dict[str, str | list[str]]:
    """Stirling multipart alanlari snake_case bekler; UI camelCase gonderir."""
    out: dict[str, str | list[str]] = {}
    for key, value in (form_data or {}).items():
        if value is None:
            continue
        snake = _camel_to_snake(str(key))
        if isinstance(value, list):
            out[snake] = [str(item) for item in value]
        else:
            out[snake] = str(value)

    # Stirling'de olmayan platform alanlari
    for drop in ("line_art", "redact_selection", "redact_pattern_ids", "custom_redact_regex", "image_scale_percent"):
        out.pop(drop, None)

    if tool_id == "compress-pdf":
        target_size = (out.get("expected_output_size") or "").strip()
        if target_size:
            out.pop("optimize_level", None)
        else:
            out.pop("expected_output_size", None)
        for key in ("linearize", "grayscale", "normalize"):
            if key in out:
                out[key] = _as_bool_str(out[key])

    if tool_id in ("add-image", "pdf-to-img", "img-to-pdf"):
        if "every_page" in out:
            out["every_page"] = _as_bool_str(out["every_page"])

    if tool_id == "add-watermark" and out.get("convert_pdf_to_image"):
        out["convert_pdf_to_image"] = _as_bool_str(out["convert_pdf_to_image"])

    return out
