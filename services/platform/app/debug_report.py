from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Settings
from .settings_store import SettingsStore


def new_report_id() -> str:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"RPT-{day}-{secrets.token_hex(3).upper()}"


def _reports_dir(settings: Settings) -> Path:
    path = settings.data_path / "debug-reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _report_path(settings: Settings, report_id: str) -> Path:
    safe = re.sub(r"[^\w\-]", "", report_id)
    return _reports_dir(settings) / f"{safe}.json"


def is_debug_mode(settings: Settings) -> bool:
    return bool(SettingsStore(settings).merged_system().get("debug_mode"))


def write_job_debug_report(
    settings: Settings,
    *,
    report_id: str,
    job_id: str,
    user_id: str,
    tool_id: str,
    status: str,
    error_code: str | None,
    created_at: str | None,
    completed_at: str | None,
    stirling_status: int | None = None,
    stirling_body: bytes | None = None,
    form_fields: list[str] | None = None,
    input_ref_count: int = 0,
) -> dict[str, Any]:
    debug = is_debug_mode(settings)
    payload: dict[str, Any] = {
        "reportId": report_id,
        "jobId": job_id,
        "userId": user_id,
        "toolId": tool_id,
        "status": status,
        "errorCode": error_code,
        "createdAt": created_at,
        "completedAt": completed_at,
        "debugMode": debug,
        "inputRefCount": input_ref_count,
    }
    if form_fields:
        payload["formFieldNames"] = form_fields
    if stirling_status is not None:
        payload["stirlingStatus"] = stirling_status
    if stirling_body:
        # Kullanıcıya kısa ipucu (her zaman); tam gövde yalnızca debug.
        text = stirling_body[:800].decode("utf-8", errors="replace").strip()
        if text and not text.startswith("<"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    for key in ("message", "error", "detail", "title"):
                        val = parsed.get(key)
                        if isinstance(val, str) and val.strip():
                            text = val.strip()
                            break
            except json.JSONDecodeError:
                pass
            snippet = " ".join(text.split())
            if snippet:
                payload["publicHint"] = snippet[:240]
        if debug:
            payload["stirlingBodySnippet"] = stirling_body[:2048].decode(
                "utf-8", errors="replace"
            )
    try:
        _report_path(settings, report_id).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass
    return payload


def read_job_debug_report(settings: Settings, report_id: str) -> dict[str, Any] | None:
    path = _report_path(settings, report_id)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, OSError):
        return None
