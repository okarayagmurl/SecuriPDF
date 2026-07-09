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


def _safe_form_context(tool_id: str, form_data: dict[str, Any] | None) -> dict[str, str]:
    if not form_data:
        return {}
    out: dict[str, str] = {}
    if tool_id == "url-to-pdf":
        url = str(form_data.get("urlInput") or "").strip()
        if url:
            out["urlInput"] = url[:500]
    return out


def _extract_body_hint(body: bytes, limit: int = 240) -> str:
    text = body[:2000].decode("utf-8", errors="replace").strip()
    if not text:
        return ""
    if text.startswith("<"):
        text = re.sub(r"<script[^>]*>[\s\S]*?</script>", " ", text, flags=re.I)
        text = re.sub(r"<style[^>]*>[\s\S]*?</style>", " ", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            for key in ("message", "error", "detail", "title", "status"):
                val = parsed.get(key)
                if isinstance(val, str) and val.strip():
                    text = val.strip()
                    break
    except json.JSONDecodeError:
        pass
    snippet = " ".join(text.split())
    return snippet[:limit]


def _build_public_hint(
    *,
    error_code: str | None,
    stirling_status: int | None,
    stirling_body: bytes | None,
    form_context: dict[str, str],
) -> str:
    parts: list[str] = []
    if stirling_body:
        hint = _extract_body_hint(stirling_body)
        if hint:
            parts.append(hint)
    if not parts and stirling_status is not None:
        parts.append(f"Stirling HTTP {stirling_status}")
    if error_code == "STIRLING_WEASYPRINT_MISSING":
        parts.append("WeasyPrint eksik veya sayfa alınamadı")
    url = form_context.get("urlInput")
    if url:
        parts.append(f"URL: {url[:160]}")
    if not parts and error_code:
        parts.append(str(error_code))
    return " — ".join(parts)[:240]


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
    form_data: dict[str, Any] | None = None,
    input_ref_count: int = 0,
) -> dict[str, Any]:
    debug = is_debug_mode(settings)
    form_context = _safe_form_context(tool_id, form_data)
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
    if form_context:
        payload["formContext"] = form_context
    if stirling_status is not None:
        payload["stirlingStatus"] = stirling_status
    hint = _build_public_hint(
        error_code=error_code,
        stirling_status=stirling_status,
        stirling_body=stirling_body,
        form_context=form_context,
    )
    if hint:
        payload["publicHint"] = hint
    if stirling_body and debug:
        payload["stirlingBodySnippet"] = stirling_body[:2048].decode(
            "utf-8", errors="replace"
        )
    elif stirling_body and not debug:
        payload["stirlingBodyLength"] = len(stirling_body)
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
