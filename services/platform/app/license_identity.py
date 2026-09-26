"""Kurulum kimligi, lisans talebi (.req) ve demo aktivasyonu."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException

from .config import Settings
from .settings_store import SettingsStore

PRODUCT = "SecuriPDF"
REQUEST_VERSION = 1
DEMO_DAYS_DEFAULT = 30
DEMO_PACKAGE = "demo"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_or_create_installation_id(settings: Settings) -> str:
    store = SettingsStore(settings)
    data = store._override()  # noqa: SLF001
    dep = dict(data.get("deployment") or {})
    existing = str(dep.get("installation_id") or "").strip()
    if existing:
        return existing
    new_id = f"SPDF-INST-{uuid.uuid4().hex[:16].upper()}"
    dep["installation_id"] = new_id
    data["deployment"] = dep
    store._save_override(data)  # noqa: SLF001
    return new_id


def license_runtime(settings: Settings) -> dict[str, Any]:
    """Lisans ozeti + talep/demo durumu (Admin UI)."""
    from .license import LicenseService

    store = SettingsStore(settings)
    lic = store.merged_license()
    svc = LicenseService(settings)
    status = svc.status()
    install_id = get_or_create_installation_id(settings)
    license_type = str(lic.get("license_type") or "none").strip().lower()
    if not license_type or license_type == "none":
        # Eski license.yml: package var ama tip yok
        if lic.get("license_key") or (lic.get("package") and lic.get("package") != "unlicensed"):
            license_type = "legacy"
    demo_started = bool(lic.get("demo_started_at"))
    can_start_demo = license_type in ("none", "unlicensed", "") or (
        license_type == "demo" and status.get("expired")
    )
    # Legacy enterprise lab: demo baslatma kapali (zaten lisansli)
    if license_type == "legacy" and status.get("valid"):
        can_start_demo = False
    return {
        **status,
        "installationId": install_id,
        "licenseType": license_type,
        "customer": lic.get("customer") or "",
        "customerId": lic.get("customer_id") or "",
        "requestId": lic.get("request_id") or "",
        "demoStartedAt": lic.get("demo_started_at"),
        "demoDays": int(lic.get("demo_days") or DEMO_DAYS_DEFAULT),
        "canStartDemo": can_start_demo,
        "demoStarted": demo_started,
    }


def build_license_request(
    settings: Settings,
    *,
    company: str,
    contact_email: str = "",
    contact_name: str = "",
    requested_package: str = "professional",
    notes: str = "",
) -> dict[str, Any]:
    company = (company or "").strip()
    if len(company) < 2:
        raise HTTPException(status_code=400, detail="Sirket / musteri adi zorunlu")
    install_id = get_or_create_installation_id(settings)
    dep = SettingsStore(settings).merged_deployment()
    request_id = f"REQ-{secrets.token_hex(6).upper()}"
    payload = {
        "v": REQUEST_VERSION,
        "type": "license_request",
        "product": PRODUCT,
        "request_id": request_id,
        "installation_id": install_id,
        "company": company,
        "contact_name": (contact_name or "").strip(),
        "contact_email": (contact_email or "").strip(),
        "requested_package": (requested_package or "professional").strip(),
        "public_fqdn": dep.get("public_fqdn") or "",
        "server_ip": dep.get("server_ip") or "",
        "created_at": _iso(_utc_now()),
        "notes": (notes or "").strip(),
    }
    # Son talebi override'a kaydet (tekrar indirme)
    store = SettingsStore(settings)
    store.update_section(
        "license",
        {
            "last_request_id": request_id,
            "last_request_at": payload["created_at"],
            "last_request_company": company,
        },
        actor="license-request",
    )
    return payload


def start_demo_license(settings: Settings, *, days: int | None = None, actor: str = "admin") -> dict[str, Any]:
    """Imzasiz yerel demo — tek sefer (veya suresi dolmus demo sonrasi yeniden)."""
    store = SettingsStore(settings)
    current = store.merged_license()
    license_type = str(current.get("license_type") or "none").strip().lower()
    runtime = license_runtime(settings)
    if not runtime.get("canStartDemo"):
        raise HTTPException(
            status_code=400,
            detail="Demo baslatilamaz: gecerli ticari/legacy lisans var veya demo zaten aktif",
        )
    days = int(days or DEMO_DAYS_DEFAULT)
    if days < 1 or days > 90:
        raise HTTPException(status_code=400, detail="Demo suresi 1-90 gun olmali")

    packages = {}
    try:
        import yaml
        from pathlib import Path

        pkg_path = settings.license_config_path.parent / "license-packages.yml"
        if pkg_path.is_file():
            packages = (yaml.safe_load(pkg_path.read_text(encoding="utf-8")) or {}).get("packages") or {}
    except Exception:  # noqa: BLE001
        packages = {}
    demo_def = packages.get(DEMO_PACKAGE) or packages.get("starter") or {}
    tools = list(demo_def.get("enabled_tools") or [])
    limits = dict(demo_def.get("limits") or {"max_users": 5, "max_concurrent_sessions": 2})
    now = _utc_now()
    expires = now + timedelta(days=days)
    install_id = get_or_create_installation_id(settings)
    payload = {
        "product": PRODUCT,
        "package": DEMO_PACKAGE,
        "license_type": "demo",
        "license_key": f"SPDF-DEMO-{secrets.token_hex(4).upper()}",
        "customer": current.get("last_request_company") or "Demo",
        "installation_id": install_id,
        "issued_at": _iso(now),
        "expires_at": _iso(expires),
        "demo_started_at": _iso(now),
        "demo_days": days,
        "apply_package_limits": True,
        "limits": limits,
        "enabled_tools": tools,
        "version": "1.0",
    }
    result = store.update_section("license", payload, actor)
    return {
        "ok": True,
        "license": result.get("license"),
        "runtime": license_runtime(settings),
    }


def activate_signed_payload(settings: Settings, verified: dict[str, Any], actor: str) -> dict[str, Any]:
    """Dogrulanmis .lic payload — installation_id eslesmesi zorunlu (demo haric degil)."""
    install_id = get_or_create_installation_id(settings)
    lic_install = str(verified.get("installation_id") or "").strip()
    if not lic_install:
        raise HTTPException(
            status_code=400,
            detail="Lisans dosyasinda installation_id yok. Entera License Manager ile .req uzerinden yeni lisans uretin.",
        )
    if lic_install != install_id:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Bu lisans baska kurulum icin: {lic_install}. "
                f"Bu sunucu: {install_id}. Dogru .req ile yeniden lisans isteyin."
            ),
        )
    from .license_file import payload_to_settings

    payload = payload_to_settings(verified)
    payload["license_type"] = str(verified.get("license_type") or "commercial")
    payload["installation_id"] = install_id
    if verified.get("request_id"):
        payload["request_id"] = str(verified["request_id"])
    if verified.get("customer_id"):
        payload["customer_id"] = str(verified["customer_id"])
    package = str(payload.get("package") or "")
    packages = {}
    try:
        import yaml

        pkg_path = settings.license_config_path.parent / "license-packages.yml"
        if pkg_path.is_file():
            packages = (yaml.safe_load(pkg_path.read_text(encoding="utf-8")) or {}).get("packages") or {}
    except Exception:  # noqa: BLE001
        packages = {}
    if package in packages and "enabled_tools" not in payload:
        from .user_tool_profiles import resolve_package_tool_ids

        payload["enabled_tools"] = resolve_package_tool_ids(settings, package)
        pkg_limits = packages[package].get("limits") or {}
        if pkg_limits and not payload.get("limits"):
            payload["limits"] = pkg_limits
    result = SettingsStore(settings).update_section("license", payload, actor)
    return {
        "ok": True,
        "customer": verified.get("customer"),
        "license": result.get("license"),
        "runtime": license_runtime(settings),
    }
