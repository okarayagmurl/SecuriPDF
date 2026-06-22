from __future__ import annotations

import json
from datetime import datetime, timezone

from .config import Settings


def write_audit(settings: Settings, user_id: str, action: str, resource: str, detail: dict | None = None) -> None:
    settings.audit_log_path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "userId": user_id,
        "action": action,
        "resource": resource,
        "detail": detail or {},
    }
    with settings.audit_log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def read_audit(
    settings: Settings,
    user_id: str | None = None,
    action: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    page: int = 1,
    size: int = 50,
) -> dict:
    if not settings.audit_log_path.exists():
        return {"items": [], "total": 0, "page": page, "size": size}

    from_dt = _parse_iso(from_ts)
    to_dt = _parse_iso(to_ts)

    items: list[dict] = []
    with settings.audit_log_path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if user_id and entry.get("userId") != user_id:
                continue
            if action and entry.get("action") != action:
                continue
            ts = _parse_iso(entry.get("timestamp"))
            if from_dt and ts and ts < from_dt:
                continue
            if to_dt and ts and ts > to_dt:
                continue
            items.append(entry)

    items.reverse()
    total = len(items)
    start = (page - 1) * size
    end = start + size
    return {"items": items[start:end], "total": total, "page": page, "size": size}
