from __future__ import annotations

import json
import threading
from typing import Any

from .config import Settings
from .user_prefs import load_user_prefs

_lock = threading.Lock()


def _path(settings: Settings):
    path = settings.data_path / "config" / "user-directory.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _load(settings: Settings) -> dict[str, dict[str, Any]]:
    path = _path(settings)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save(settings: Settings, data: dict[str, dict[str, Any]]) -> None:
    _path(settings).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def touch_user_directory(
    settings: Settings,
    user_id: str,
    email: str | None = None,
    display_name: str | None = None,
) -> None:
    if not user_id:
        return
    with _lock:
        data = _load(settings)
        entry = dict(data.get(user_id, {}))
        entry["userId"] = user_id
        if email:
            entry["email"] = email.strip()
        if display_name:
            entry["displayName"] = display_name.strip()
        data[user_id] = entry
        _save(settings, data)


def resolve_user_labels(settings: Settings, user_ids: set[str]) -> dict[str, str]:
    directory = _load(settings)
    labels: dict[str, str] = {}
    for uid in user_ids:
        if not uid:
            labels[uid] = "—"
            continue
        entry = directory.get(uid, {})
        prefs = load_user_prefs(settings, uid)
        display = (entry.get("displayName") or prefs.get("displayName") or "").strip()
        email = (entry.get("email") or "").strip()
        if display and display != uid:
            labels[uid] = display
        elif email:
            labels[uid] = email
        elif "@" in uid:
            labels[uid] = uid
        else:
            labels[uid] = uid
    return labels
