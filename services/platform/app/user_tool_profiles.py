from __future__ import annotations

import re
from typing import Any

import yaml
from fastapi import HTTPException

from .config import Settings
from .license import LicenseService
from .settings_store import SettingsStore

_PROFILE_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")


def _store(settings: Settings) -> SettingsStore:
    return SettingsStore(settings)


def _override(settings: Settings) -> dict[str, Any]:
    return _store(settings)._override()


def _save_override(settings: Settings, data: dict[str, Any]) -> None:
    _store(settings)._save_override(data)


def _normalize_user_id(user_id: str) -> str:
    return user_id.strip().lower()


def _normalize_profile_id(profile_id: str) -> str:
    return profile_id.strip().lower()


def _validate_profile_id(profile_id: str) -> str:
    pid = _normalize_profile_id(profile_id)
    if not pid or not _PROFILE_ID_RE.match(pid):
        raise HTTPException(
            status_code=400,
            detail="Profil ID: kucuk harf, rakam, tire; 2-48 karakter (ornek: muhasebe)",
        )
    return pid


def _migrate_legacy_user_profiles(settings: Settings) -> None:
    """Eski kullanici-bazli restrict kayitlarini paylasilan profillere tasi."""
    data = _override(settings)
    legacy = data.get("user_tool_profiles") or {}
    if not legacy:
        return

    profiles: dict[str, Any] = dict(data.get("tool_access_profiles") or {})
    assignments: dict[str, str] = dict(data.get("user_tool_profile_assignments") or {})
    changed = False

    for uid, raw in legacy.items():
        if str(raw.get("mode") or "").lower() != "restrict":
            continue
        norm_user = _normalize_user_id(uid)
        if not norm_user:
            continue
        pid = f"legacy-{norm_user.replace('.', '-')}"
        if pid not in profiles:
            profiles[pid] = {
                "label": (raw.get("note") or "").strip() or f"Eski profil — {norm_user}",
                "description": "Eski kullanici profilinden otomatik tasindi",
                "allowed_tools": sorted(
                    {str(t).strip() for t in (raw.get("allowed_tools") or []) if str(t).strip()}
                ),
            }
            changed = True
        if assignments.get(norm_user) != pid:
            assignments[norm_user] = pid
            changed = True

    if changed or legacy:
        if profiles:
            data["tool_access_profiles"] = profiles
        if assignments:
            data["user_tool_profile_assignments"] = assignments
        data.pop("user_tool_profiles", None)
        _save_override(settings, data)


def _licensed_tools(settings: Settings) -> set[str]:
    return set(LicenseService(settings).enabled_tools())


def _load_access_profiles(settings: Settings) -> dict[str, dict[str, Any]]:
    _migrate_legacy_user_profiles(settings)
    return dict(_override(settings).get("tool_access_profiles") or {})


def _load_assignments(settings: Settings) -> dict[str, str]:
    _migrate_legacy_user_profiles(settings)
    return dict(_override(settings).get("user_tool_profile_assignments") or {})


def _resolve_assignment_key(assignments: dict[str, str], user_id: str) -> str | None:
    norm = _normalize_user_id(user_id)
    if not norm:
        return None
    if norm in assignments:
        return norm
    for key, value in assignments.items():
        if key.strip().lower() == norm:
            return key
    return None


def _profile_payload(profile_id: str, raw: dict[str, Any], *, user_count: int = 0) -> dict[str, Any]:
    tools = raw.get("allowed_tools") or []
    if not isinstance(tools, list):
        tools = []
    return {
        "id": profile_id,
        "label": str(raw.get("label") or profile_id),
        "description": str(raw.get("description") or "").strip(),
        "allowed_tools": sorted({str(t).strip() for t in tools if str(t).strip()}),
        "toolCount": len(tools),
        "userCount": user_count,
    }


def list_tool_access_profiles(settings: Settings) -> list[dict[str, Any]]:
    profiles = _load_access_profiles(settings)
    assignments = _load_assignments(settings)
    counts: dict[str, int] = {}
    for uid, pid in assignments.items():
        counts[pid] = counts.get(pid, 0) + 1
    return [_profile_payload(pid, raw, user_count=counts.get(pid, 0)) for pid, raw in sorted(profiles.items())]


def get_tool_access_profile(settings: Settings, profile_id: str) -> dict[str, Any]:
    pid = _normalize_profile_id(profile_id)
    raw = _load_access_profiles(settings).get(pid)
    if not raw:
        raise HTTPException(status_code=404, detail=f"Profil bulunamadi: {profile_id}")
    assignments = _load_assignments(settings)
    user_count = sum(1 for p in assignments.values() if p == pid)
    return _profile_payload(pid, raw, user_count=user_count)


def create_tool_access_profile(
    settings: Settings,
    profile_id: str,
    *,
    label: str,
    description: str | None = None,
    allowed_tools: list[str] | None = None,
) -> dict[str, Any]:
    pid = _validate_profile_id(profile_id)
    profiles = _load_access_profiles(settings)
    if pid in profiles:
        raise HTTPException(status_code=409, detail=f"Profil zaten var: {pid}")

    licensed = _licensed_tools(settings)
    allowed = sorted({t for t in (allowed_tools or []) if t in licensed})
    if not allowed:
        raise HTTPException(status_code=400, detail="Profilde en az bir lisansli arac secin")

    profiles[pid] = {
        "label": (label or pid).strip(),
        "description": (description or "").strip(),
        "allowed_tools": allowed,
    }
    data = _override(settings)
    data["tool_access_profiles"] = profiles
    _save_override(settings, data)
    return get_tool_access_profile(settings, pid)


def update_tool_access_profile(
    settings: Settings,
    profile_id: str,
    *,
    label: str | None = None,
    description: str | None = None,
    allowed_tools: list[str] | None = None,
) -> dict[str, Any]:
    pid = _normalize_profile_id(profile_id)
    profiles = _load_access_profiles(settings)
    if pid not in profiles:
        raise HTTPException(status_code=404, detail=f"Profil bulunamadi: {profile_id}")

    raw = dict(profiles[pid])
    if label is not None:
        raw["label"] = label.strip() or pid
    if description is not None:
        raw["description"] = description.strip()
    if allowed_tools is not None:
        licensed = _licensed_tools(settings)
        allowed = sorted({t for t in allowed_tools if t in licensed})
        if not allowed:
            raise HTTPException(status_code=400, detail="Profilde en az bir lisansli arac secin")
        raw["allowed_tools"] = allowed

    profiles[pid] = raw
    data = _override(settings)
    data["tool_access_profiles"] = profiles
    _save_override(settings, data)
    return get_tool_access_profile(settings, pid)


def delete_tool_access_profile(settings: Settings, profile_id: str) -> dict[str, Any]:
    pid = _normalize_profile_id(profile_id)
    profiles = _load_access_profiles(settings)
    if pid not in profiles:
        raise HTTPException(status_code=404, detail=f"Profil bulunamadi: {profile_id}")

    assignments = _load_assignments(settings)
    users_on = [u for u, p in assignments.items() if p == pid]
    if users_on:
        raise HTTPException(
            status_code=409,
            detail=f"Profil {len(users_on)} kullaniciya atanmis; once atamalari kaldirin",
        )

    profiles.pop(pid)
    data = _override(settings)
    if profiles:
        data["tool_access_profiles"] = profiles
    else:
        data.pop("tool_access_profiles", None)
    _save_override(settings, data)
    return {"ok": True, "deleted": pid}


def list_user_assignments(settings: Settings) -> dict[str, str]:
    return _load_assignments(settings)


def get_user_assignment(settings: Settings, user_id: str) -> str | None:
    assignments = _load_assignments(settings)
    key = _resolve_assignment_key(assignments, user_id)
    if not key:
        return None
    return assignments.get(key)


def set_user_assignment(settings: Settings, user_id: str, profile_id: str | None) -> dict[str, Any]:
    norm = _normalize_user_id(user_id)
    if not norm:
        raise HTTPException(status_code=400, detail="Kullanici adi gerekli")

    assignments = _load_assignments(settings)
    for legacy_key in [k for k in assignments if k.strip().lower() == norm and k != norm]:
        assignments.pop(legacy_key, None)

    if not profile_id:
        assignments.pop(norm, None)
    else:
        pid = _normalize_profile_id(profile_id)
        if pid not in _load_access_profiles(settings):
            raise HTTPException(status_code=404, detail=f"Profil bulunamadi: {profile_id}")
        assignments[norm] = pid

    data = _override(settings)
    if assignments:
        data["user_tool_profile_assignments"] = assignments
    else:
        data.pop("user_tool_profile_assignments", None)
    _save_override(settings, data)
    return get_user_tool_assignment(settings, norm)


def get_user_tool_assignment(settings: Settings, user_id: str) -> dict[str, Any]:
    norm = _normalize_user_id(user_id)
    profile_id = get_user_assignment(settings, norm)
    licensed = sorted(_licensed_tools(settings))
    profile = None
    effective: list[str] = licensed

    if profile_id:
        try:
            profile = get_tool_access_profile(settings, profile_id)
            effective = sorted(set(licensed) & set(profile.get("allowed_tools") or []))
        except HTTPException:
            profile_id = None
            effective = licensed

    return {
        "userId": norm,
        "profileId": profile_id,
        "profile": profile,
        "licensedTools": licensed,
        "effectiveTools": effective,
    }


def effective_tool_ids(settings: Settings, user_id: str | None) -> set[str]:
    licensed = _licensed_tools(settings)
    if not user_id:
        return licensed
    profile_id = get_user_assignment(settings, user_id)
    if not profile_id:
        return licensed
    profiles = _load_access_profiles(settings)
    raw = profiles.get(profile_id) or {}
    allowed = set(raw.get("allowed_tools") or [])
    if not allowed:
        return licensed
    return licensed & allowed


def assert_user_tool_allowed(settings: Settings, user_id: str, tool_id: str) -> None:
    allowed = effective_tool_ids(settings, user_id)
    if allowed and tool_id not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Bu kullanici icin '{tool_id}' araci acik degil",
        )


# —— Geriye uyumluluk (eski admin API) ——

def get_user_tool_profile(settings: Settings, user_id: str) -> dict[str, Any]:
    data = get_user_tool_assignment(settings, user_id)
    profile_id = data.get("profileId")
    if not profile_id:
        return {
            "userId": data["userId"],
            "mode": "inherit",
            "profileId": None,
            "allowed_tools": data.get("licensedTools") or [],
            "note": "",
        }
    profile = data.get("profile") or {}
    return {
        "userId": data["userId"],
        "mode": "profile",
        "profileId": profile_id,
        "allowed_tools": profile.get("allowed_tools") or [],
        "note": profile.get("label") or "",
    }


def list_user_tool_profiles(settings: Settings) -> dict[str, dict[str, Any]]:
    assignments = _load_assignments(settings)
    return {uid: get_user_tool_profile(settings, uid) for uid in assignments}


def save_user_tool_profile(
    settings: Settings,
    user_id: str,
    *,
    mode: str,
    allowed_tools: list[str] | None = None,
    note: str | None = None,
    profile_id: str | None = None,
) -> dict[str, Any]:
    if profile_id:
        set_user_assignment(settings, user_id, profile_id)
        return get_user_tool_profile(settings, user_id)

    mode = (mode or "inherit").strip().lower()
    if mode == "inherit":
        set_user_assignment(settings, user_id, None)
        return get_user_tool_profile(settings, user_id)

    if mode == "restrict":
        norm = _normalize_user_id(user_id)
        pid = f"legacy-{norm.replace('.', '-')}"
        licensed = _licensed_tools(settings)
        allowed = sorted({t for t in (allowed_tools or []) if t in licensed})
        if not allowed:
            raise HTTPException(status_code=400, detail="En az bir lisansli arac secin")
        profiles = _load_access_profiles(settings)
        profiles[pid] = {
            "label": (note or "").strip() or f"Ozel — {norm}",
            "description": "Kullaniciya ozel profil",
            "allowed_tools": allowed,
        }
        data = _override(settings)
        data["tool_access_profiles"] = profiles
        _save_override(settings, data)
        set_user_assignment(settings, user_id, pid)
        return get_user_tool_profile(settings, user_id)

    raise HTTPException(status_code=400, detail="mode: inherit, restrict veya profile_id kullanin")


def load_license_packages(settings: Settings) -> dict[str, Any]:
    path = settings.license_config_path.parent / "license-packages.yml"
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def resolve_package_tool_ids(settings: Settings, package: str) -> list[str]:
    from .maintenance import load_tools_config

    enabled = list(load_tools_config(settings).get("enabled") or [])
    enabled_set = set(enabled)
    packages = load_license_packages(settings).get("packages") or {}
    pkg_def = packages.get(package) or {}
    if package == "enterprise":
        return sorted(enabled_set)
    pkg_tools = pkg_def.get("enabled_tools") or []
    if not pkg_tools:
        return sorted(enabled_set)
    return sorted(set(pkg_tools) & enabled_set)
