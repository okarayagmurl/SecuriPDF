from __future__ import annotations

import base64
import json
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from sqlalchemy.orm import Session

from ..auth import AuthUser, get_current_user
from ..config import Settings, get_settings
from ..database import get_db
from ..ops import get_user_usage_stats
from ..settings_store import SettingsStore
from ..tools_catalog import _load_ui_catalog, list_ui_tools
from ..user_directory import touch_user_directory
from ..user_prefs import load_user_prefs, save_user_prefs
from ..license import LicenseService

router = APIRouter(tags=["app"])

CATEGORY_LABELS = {
    "recommended": "Önerilen",
    "convert": "Dönüşüm",
    "optimize": "Optimizasyon",
    "pages": "Sayfa düzenleme",
    "security": "Belge güvenliği",
    "signing": "İmza",
    "verification": "Doğrulama",
    "review": "İnceleme",
    "extract": "Çıkarma",
    "remove": "Kaldırma",
    "advanced": "Gelişmiş",
    "automation": "Otomasyon",
    "organize": "Belge organizasyonu",
    "edit": "Sayfa düzenleme",
    "other": "Diğer",
}

CATEGORY_ORDER = [
    "recommended",
    "convert",
    "optimize",
    "pages",
    "security",
    "signing",
    "verification",
    "review",
    "extract",
    "remove",
    "advanced",
    "automation",
    "organize",
    "edit",
    "other",
]


def _friendly_display_name(user: AuthUser, prefs: dict) -> str:
    custom = (prefs.get("displayName") or "").strip()
    if custom and custom != user.user_id:
        return custom
    if user.email and "@" in user.email:
        local = user.email.split("@", 1)[0]
        return local.replace(".", " ").replace("_", " ").strip().title() or user.email
    return "Kullanıcı"


class ProfileUpdate(BaseModel):
    displayName: str | None = None
    locale: str | None = None
    favoriteTools: list[str] | None = None


@router.get("/me")
def app_me(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    prefs = load_user_prefs(settings, user.user_id)
    display = _friendly_display_name(user, prefs)
    touch_user_directory(settings, user.user_id, email=user.email, display_name=display)
    return {
        "userId": user.user_id,
        "email": user.email,
        "displayName": display,
        "groups": user.groups,
        "isAdmin": user.is_admin,
        "favoriteTools": prefs.get("favoriteTools", []),
        "locale": prefs.get("locale", "tr-TR"),
    }


@router.get("/stats/usage")
def app_usage_stats(
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_user_usage_stats(db, user.user_id)


@router.get("/profile")
def get_profile(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    prefs = load_user_prefs(settings, user.user_id)
    return {
        "userId": user.user_id,
        "email": user.email,
        "displayName": prefs.get("displayName", ""),
        "locale": prefs.get("locale", "tr-TR"),
        "favoriteTools": prefs.get("favoriteTools", []),
        "license": LicenseService(settings).public_status(),
    }


@router.get("/license")
def app_license(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    return LicenseService(settings).public_status()


@router.put("/profile")
def update_profile(
    body: ProfileUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    payload: dict[str, Any] = {}
    if body.displayName is not None:
        payload["displayName"] = body.displayName.strip()
    if body.locale is not None:
        payload["locale"] = body.locale.strip()
    if body.favoriteTools is not None:
        payload["favoriteTools"] = body.favoriteTools
    saved = save_user_prefs(settings, user.user_id, payload)
    touch_user_directory(
        settings,
        user.user_id,
        email=user.email,
        display_name=(saved.get("displayName") or "").strip() or None,
    )
    return {"ok": True, "profile": saved}


@router.get("/logout-url")
def logout_url():
    # Goreli yol — tarayicinin actigi host/IP uzerinden cikis (localhost API URL'si uretme)
    return {"url": "/oauth2/sign_out"}


@router.get("/branding")
def app_branding(settings: Settings = Depends(get_settings)):
    brand = SettingsStore(settings).merged_branding()
    has_customer = bool(brand.get("customer_logo_b64"))
    return {
        "appName": brand.get("navbar_name") or brand.get("app_name"),
        "homeDescription": brand.get("home_description"),
        "primaryColor": brand.get("primary_color", "#1d4ed8"),
        "accentColor": brand.get("accent_color", "#0f766e"),
        "platformLogoUrl": "/api/app/v1/branding/platform-logo",
        "platformIconUrl": "/api/app/v1/branding/platform-icon",
        "customerLogoUrl": "/api/app/v1/branding/customer-logo" if has_customer else None,
    }


def _logo_response(b64_data: str) -> Response:
    if not b64_data:
        raise HTTPException(status_code=404, detail="Logo bulunamadi")
    if "," in b64_data:
        b64_data = b64_data.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64_data)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=404, detail="Gecersiz logo") from exc
    media = "image/png"
    if raw[:3] == b"\xff\xd8\xff":
        media = "image/jpeg"
    elif raw.startswith(b"<") or raw.startswith(b"<?"):
        media = "image/svg+xml"
    return Response(content=raw, media_type=media)


@router.get("/branding/customer-logo")
def customer_logo(settings: Settings = Depends(get_settings)):
    brand = SettingsStore(settings).merged_branding()
    return _logo_response(str(brand.get("customer_logo_b64") or ""))


@router.get("/branding/platform-icon")
def platform_icon(settings: Settings = Depends(get_settings)):
    brand = SettingsStore(settings).merged_branding()
    b64 = brand.get("platform_icon_b64")
    if b64:
        return _logo_response(str(b64))
    icon_path = os.path.join(os.path.dirname(__file__), "..", "static", "app", "platform-icon.svg")
    favicon_path = os.path.join(os.path.dirname(__file__), "..", "static", "app", "favicon.svg")
    if os.path.isfile(icon_path):
        return Response(content=open(icon_path, "rb").read(), media_type="image/svg+xml")
    if os.path.isfile(favicon_path):
        return Response(content=open(favicon_path, "rb").read(), media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="Platform ikonu yok")


@router.get("/branding/platform-logo")
def platform_logo(settings: Settings = Depends(get_settings)):
    brand = SettingsStore(settings).merged_branding()
    b64 = brand.get("platform_logo_b64")
    if b64:
        return _logo_response(str(b64))
    for name in ("platform-logo.svg", "favicon.svg"):
        svg_path = os.path.join(os.path.dirname(__file__), "..", "static", "app", name)
        if os.path.isfile(svg_path):
            return Response(content=open(svg_path, "rb").read(), media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="Platform logosu yok")


@router.get("/storage")
def storage_layout(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    from ..vault_retention import documents_ttl

    vault = SettingsStore(settings).merged_vault()
    roots = vault.get("storage_roots", {})
    retention = vault.get("retention", {})
    base = str(settings.data_path)
    ttl = documents_ttl(settings)
    return {
        "documentsRoot": roots.get("documents", "documents"),
        "archiveRoot": roots.get("archive", "archive"),
        "dataPath": base,
        "defaultDocumentList": vault.get("ui", {}).get("default_document_list", "all"),
        "documentsTtlValue": int(retention.get("documents_ttl_value", 7)),
        "documentsTtlUnit": retention.get("documents_ttl_unit", "days"),
        "documentsTtlHours": round(ttl.total_seconds() / 3600, 2),
    }


@router.post("/redaction/metadata")
async def redaction_metadata(
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    from ..redaction_renderer import get_pdf_page_metadata

    form = await request.form()
    upload = form.get("fileInput")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=400, detail="PDF dosyası gerekli")
    pdf_bytes = await upload.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Boş dosya")
    return get_pdf_page_metadata(pdf_bytes)


@router.post("/redaction/scan")
async def redaction_scan(
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    from ..redaction_renderer import RedactionError, scan_pdf_redactions

    form = await request.form()
    upload = form.get("fileInput")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=400, detail="PDF dosyası gerekli")
    pdf_bytes = await upload.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Boş dosya")

    ids_raw = form.get("redactPatternIds") or "[]"
    try:
        pattern_ids = json.loads(str(ids_raw))
        if not isinstance(pattern_ids, list):
            pattern_ids = []
    except json.JSONDecodeError:
        pattern_ids = []
    custom_regex = str(form.get("customRedactRegex") or "").strip()
    if not pattern_ids and not custom_regex:
        raise HTTPException(status_code=400, detail="En az bir desen seçin")

    try:
        return scan_pdf_redactions(pdf_bytes, pattern_ids, custom_regex)
    except RedactionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/redaction-patterns")
def redaction_patterns(user: AuthUser = Depends(get_current_user)):
    from ..redaction_presets import CATEGORY_LABELS, list_redaction_presets

    presets = list_redaction_presets()
    categories = sorted({p["category"] for p in presets})
    return {
        "presets": presets,
        "categories": [
            {"id": cat, "label": CATEGORY_LABELS.get(cat, cat)} for cat in categories
        ],
    }


@router.get("/tools")
def app_tools(user: AuthUser = Depends(get_current_user), settings: Settings = Depends(get_settings)):
    catalog = _load_ui_catalog()
    tools = list_ui_tools(settings, user.user_id)
    by_category: dict[str, list] = {}
    for tool in tools:
        cat = tool.get("category", "other")
        tool["categoryLabel"] = CATEGORY_LABELS.get(cat, cat)
        by_category.setdefault(cat, []).append(tool)
    ordered_ids = [c for c in CATEGORY_ORDER if c in by_category]
    for cat in sorted(by_category.keys()):
        if cat not in ordered_ids:
            ordered_ids.append(cat)
    categories = [
        {
            "id": cat,
            "label": CATEGORY_LABELS.get(cat, cat),
            "tools": by_category[cat],
        }
        for cat in ordered_ids
        if by_category.get(cat)
    ]
    prefs = load_user_prefs(settings, user.user_id)
    fav = set(prefs.get("favoriteTools") or [])
    for tool in tools:
        tool["isFavorite"] = tool["id"] in fav
    return {
        "phase": catalog.get("phase", 1),
        "tools": tools,
        "categories": categories,
        "favoriteTools": list(fav),
    }


@router.put("/tools/favorites")
def update_favorites(
    body: ProfileUpdate,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    if body.favoriteTools is None:
        raise HTTPException(status_code=400, detail="favoriteTools gerekli")
    saved = save_user_prefs(settings, user.user_id, {"favoriteTools": body.favoriteTools})
    return {"ok": True, "favoriteTools": saved.get("favoriteTools", [])}
