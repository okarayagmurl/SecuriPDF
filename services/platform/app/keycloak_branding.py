from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

from .settings_store import SettingsStore


def _theme_img_dir() -> Path | None:
    raw = os.getenv("KEYCLOAK_THEME_IMG_DIR", "").strip()
    if not raw:
        return None
    path = Path(raw)
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return path if path.is_dir() else None


def _decode_logo_b64(b64_data: str) -> tuple[bytes, str]:
    data = str(b64_data or "").strip()
    if not data:
        raise ValueError("Logo verisi bos")
    if "," in data:
        data = data.split(",", 1)[1]
    raw = base64.b64decode(data)
    if raw.startswith(b"<") or raw.startswith(b"<?"):
        return raw, "image/svg+xml"
    if raw[:3] == b"\xff\xd8\xff":
        return raw, "image/jpeg"
    return raw, "image/png"


def _as_login_svg(raw: bytes, media: str) -> bytes:
    if media == "image/svg+xml":
        return raw
    encoded = base64.b64encode(raw).decode("ascii")
    wrapper = (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'viewBox="0 0 700 180" role="img" aria-label="Login logo">'
        f'<image width="700" height="180" preserveAspectRatio="xMidYMid meet" '
        f'xlink:href="data:{media};base64,{encoded}"/></svg>'
    )
    return wrapper.encode("utf-8")


def sync_keycloak_login_logo(settings: Any) -> dict[str, Any]:
    """Admin branding kaydindan Keycloak login logosunu (logo.svg) gunceller."""
    theme_dir = _theme_img_dir()
    if not theme_dir:
        return {"ok": False, "skipped": True, "reason": "KEYCLOAK_THEME_IMG_DIR tanimli degil"}

    brand = SettingsStore(settings).merged_branding()
    b64 = brand.get("platform_logo_b64") or brand.get("customer_logo_b64")
    if not b64:
        return {"ok": False, "skipped": True, "reason": "Yuklu platform veya musteri logosu yok"}

    try:
        raw, media = _decode_logo_b64(str(b64))
        svg_bytes = _as_login_svg(raw, media)
    except (ValueError, TypeError) as exc:
        return {"ok": False, "error": f"Logo cozulemedi: {exc}"}

    target = theme_dir / "logo.svg"
    target.write_bytes(svg_bytes)
    return {
        "ok": True,
        "path": str(target),
        "bytes": len(svg_bytes),
        "sourceMedia": media,
    }
