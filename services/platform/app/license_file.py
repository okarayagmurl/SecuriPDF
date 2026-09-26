"""Imzali .lic dosyasi dogrulama ve Admin aktivasyonu."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import HTTPException

PRODUCT = "SecuriPDF"

# tools/securipdf-license/keys/vendor.ed25519.pub ile eslesmeli
DEFAULT_PUBLIC_KEY_B64 = "YVD+qpgIhuQ0quPaloo8liC+WYpeFuBdBmx6PmaHY9g="


def _canonical(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _public_key() -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(base64.b64decode(DEFAULT_PUBLIC_KEY_B64))


def parse_and_verify(raw: str | bytes | dict[str, Any]) -> dict[str, Any]:
    if isinstance(raw, dict):
        doc = raw
    else:
        text = raw.decode("utf-8-sig") if isinstance(raw, (bytes, bytearray)) else str(raw)
        if text.startswith("\ufeff"):
            text = text.lstrip("\ufeff")
        try:
            doc = json.loads(text)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"Lisans JSON okunamadi: {exc}") from exc
    if not isinstance(doc, dict) or "payload" not in doc or "sig" not in doc:
        raise HTTPException(status_code=400, detail="Gecersiz .lic yapisi")
    payload = doc["payload"]
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload gecersiz")
    if payload.get("product") != PRODUCT:
        raise HTTPException(status_code=400, detail="Urun uyusmuyor")
    try:
        _public_key().verify(base64.b64decode(doc["sig"]), _canonical(payload))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Lisans imzasi gecersiz: {exc}") from exc
    expires = payload.get("expires_at")
    if expires:
        try:
            exp_dt = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
            if exp_dt < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="Lisans suresi dolmus")
        except HTTPException:
            raise
        except ValueError:
            pass
    return payload


def payload_to_settings(payload: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "package": str(payload.get("package") or "starter"),
        "license_key": str(payload.get("license_key") or ""),
        "apply_package_limits": bool(payload.get("apply_package_limits", True)),
        "license_type": str(payload.get("license_type") or "commercial"),
    }
    if payload.get("expires_at"):
        out["expires_at"] = str(payload["expires_at"])
    if payload.get("issued_at"):
        out["issued_at"] = str(payload["issued_at"])
    if payload.get("installation_id"):
        out["installation_id"] = str(payload["installation_id"])
    if payload.get("request_id"):
        out["request_id"] = str(payload["request_id"])
    if payload.get("customer_id"):
        out["customer_id"] = str(payload["customer_id"])
    limits = payload.get("limits")
    if isinstance(limits, dict) and limits:
        out["limits"] = {k: int(v) for k, v in limits.items() if v is not None}
    tools = payload.get("enabled_tools")
    if isinstance(tools, list) and tools:
        out["enabled_tools"] = [str(t) for t in tools]
    customer = str(payload.get("customer") or "").strip()
    if customer:
        out["customer"] = customer
    return out
