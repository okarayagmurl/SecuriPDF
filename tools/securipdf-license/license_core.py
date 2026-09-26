"""SecuriPDF lisans dosyası (.lic) — imza, doğrulama, paket çözümleme."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

PRODUCT = "SecuriPDF"
LICENSE_VERSION = 1

# Platform ile aynı vendor public key (Ed25519 raw, base64)
DEFAULT_PUBLIC_KEY_B64 = "YVD+qpgIhuQ0quPaloo8liC+WYpeFuBdBmx6PmaHY9g="


def _canonical(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def load_private_key(path: Path | None = None, raw_b64: str | None = None) -> Ed25519PrivateKey:
    if raw_b64:
        return Ed25519PrivateKey.from_private_bytes(base64.b64decode(raw_b64))
    if path is None:
        path = Path(__file__).resolve().parent / "keys" / "vendor.ed25519.priv"
    data = path.read_bytes()
    if len(data) == 32:
        return Ed25519PrivateKey.from_private_bytes(data)
    # PEM veya base64 satırı
    text = data.decode("utf-8").strip()
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(text))


def load_public_key(path: Path | None = None, raw_b64: str | None = None) -> Ed25519PublicKey:
    if raw_b64:
        return Ed25519PublicKey.from_public_bytes(base64.b64decode(raw_b64))
    if path is None:
        path = Path(__file__).resolve().parent / "keys" / "vendor.ed25519.pub"
    if path.is_file():
        data = path.read_bytes()
        if len(data) == 32:
            return Ed25519PublicKey.from_public_bytes(data)
        return Ed25519PublicKey.from_public_bytes(base64.b64decode(data.decode("utf-8").strip()))
    return Ed25519PublicKey.from_public_bytes(base64.b64decode(DEFAULT_PUBLIC_KEY_B64))


def generate_license_key(package: str, customer: str = "") -> str:
    slug = "".join(c for c in package.upper() if c.isalnum())[:8] or "PKG"
    cust = "".join(c for c in customer.upper() if c.isalnum())[:6] or "GEN"
    token = secrets.token_hex(4).upper()
    digest = hashlib.sha256(f"{slug}:{cust}:{token}".encode()).hexdigest()[:8].upper()
    return f"SPDF-{slug}-{cust}-{token}-{digest}"


def build_payload(
    *,
    package: str,
    customer: str,
    expires_at: str | None,
    max_users: int | None = None,
    max_sessions: int | None = None,
    enabled_tools: list[str] | None = None,
    license_key: str | None = None,
    notes: str = "",
) -> dict[str, Any]:
    issued = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    limits: dict[str, int] = {}
    if max_users is not None:
        limits["max_users"] = int(max_users)
    if max_sessions is not None:
        limits["max_concurrent_sessions"] = int(max_sessions)
    payload: dict[str, Any] = {
        "product": PRODUCT,
        "package": package.strip(),
        "customer": customer.strip(),
        "license_key": license_key or generate_license_key(package, customer),
        "issued_at": issued,
        "expires_at": expires_at,
        "limits": limits,
        "apply_package_limits": True,
        "notes": notes.strip(),
    }
    if enabled_tools is not None:
        payload["enabled_tools"] = list(enabled_tools)
    return payload


def sign_license(payload: dict[str, Any], private_key: Ed25519PrivateKey) -> dict[str, Any]:
    sig = private_key.sign(_canonical(payload))
    return {
        "v": LICENSE_VERSION,
        "payload": payload,
        "sig": base64.b64encode(sig).decode("ascii"),
    }


def verify_license(doc: dict[str, Any], public_key: Ed25519PublicKey | None = None) -> dict[str, Any]:
    if not isinstance(doc, dict) or "payload" not in doc or "sig" not in doc:
        raise ValueError("Gecersiz lisans dosyasi yapisi")
    payload = doc["payload"]
    if not isinstance(payload, dict):
        raise ValueError("payload dict olmali")
    if payload.get("product") != PRODUCT:
        raise ValueError(f"Urun uyusmuyor: {payload.get('product')}")
    key = public_key or load_public_key()
    try:
        key.verify(base64.b64decode(doc["sig"]), _canonical(payload))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Imza dogrulanamadi: {exc}") from exc
    expires = payload.get("expires_at")
    expired = False
    if expires:
        try:
            exp_dt = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
            expired = exp_dt < datetime.now(timezone.utc)
        except ValueError:
            pass
    return {
        "valid": not expired,
        "expired": expired,
        "payload": payload,
    }


def write_lic(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_lic(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_packages(packages_yml: Path) -> dict[str, Any]:
    import yaml

    if not packages_yml.is_file():
        return {}
    with packages_yml.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}
