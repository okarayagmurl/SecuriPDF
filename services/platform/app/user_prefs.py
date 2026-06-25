from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import Settings


def _prefs_path(settings: Settings, user_id: str) -> Path:
    path = settings.data_path / "prefs" / f"{user_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def load_user_prefs(settings: Settings, user_id: str) -> dict[str, Any]:
    path = _prefs_path(settings, user_id)
    if not path.exists():
        return {"favoriteTools": [], "displayName": "", "locale": "tr-TR"}
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        return {"favoriteTools": [], "displayName": "", "locale": "tr-TR"}
    data.setdefault("favoriteTools", [])
    data.setdefault("displayName", "")
    data.setdefault("locale", "tr-TR")
    return data


def save_user_prefs(settings: Settings, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    path = _prefs_path(settings, user_id)
    current = load_user_prefs(settings, user_id)
    for key in ("favoriteTools", "displayName", "locale"):
        if key in data:
            current[key] = data[key]
    if "favoriteTools" in current and not isinstance(current["favoriteTools"], list):
        current["favoriteTools"] = []
    with path.open("w", encoding="utf-8") as handle:
        json.dump(current, handle, ensure_ascii=False, indent=2)
    return current
