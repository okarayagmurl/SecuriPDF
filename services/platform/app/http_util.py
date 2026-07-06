from __future__ import annotations

from urllib.parse import quote


def content_disposition(disposition: str, filename: str) -> str:
    """Build Content-Disposition safe for Starlette (header values must be latin-1)."""
    name = (filename or "download").replace("\r", "").replace("\n", "")
    safe = name.replace("\\", "\\\\").replace('"', '\\"')
    try:
        safe.encode("latin-1")
        return f'{disposition}; filename="{safe}"'
    except UnicodeEncodeError:
        ascii_fallback = name.encode("ascii", "ignore").decode("ascii").strip() or "download"
        ascii_fallback = ascii_fallback.replace('"', "")
        encoded = quote(name, safe="")
        return f'{disposition}; filename="{ascii_fallback}"; filename*=UTF-8\'\'{encoded}'
