from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from .config import Settings
from .license import LicenseService

_UI_TOOLS_PATH = Path("/config/ui-tools.yml")


def _load_ui_catalog() -> dict[str, Any]:
    if not _UI_TOOLS_PATH.exists():
        return {"phase": 1, "tools": []}
    with _UI_TOOLS_PATH.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {"tools": []}


def _licensed_tool_ids(settings: Settings) -> set[str]:
    enabled = LicenseService(settings).status().get("enabledTools") or []
    return set(enabled)


def list_ui_tools(settings: Settings, user_id: str | None = None) -> list[dict[str, Any]]:
    from .user_tool_profiles import effective_tool_ids

    catalog = _load_ui_catalog()
    licensed = effective_tool_ids(settings, user_id)
    tools: list[dict[str, Any]] = []
    for item in catalog.get("tools") or []:
        tool_id = str(item.get("id", "")).strip()
        if not tool_id:
            continue
        if licensed and tool_id not in licensed:
            continue
        tools.append(
            {
                "id": tool_id,
                "title": item.get("title", tool_id),
                "description": item.get("description", ""),
                "category": item.get("category", "other"),
                "icon": item.get("icon", "tool"),
                "inputs": item.get("inputs") or [],
            }
        )
    return tools


def get_ui_tool(settings: Settings, tool_id: str, user_id: str | None = None) -> dict[str, Any]:
    for tool in list_ui_tools(settings, user_id):
        if tool["id"] == tool_id:
            return tool
    raise HTTPException(status_code=404, detail=f"Araç bulunamadı: {tool_id}")


def get_tool_api_path(tool_id: str) -> str:
    catalog = _load_ui_catalog()
    for item in catalog.get("tools") or []:
        if item.get("id") == tool_id:
            path = str(item.get("apiPath", "")).strip()
            if path:
                return path
            break
    raise HTTPException(status_code=404, detail=f"API yolu tanımlı değil: {tool_id}")
