from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .config import Settings
from .database import SessionRecord


class LicenseService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._config = self._load()
        self._packages = self._load_packages()

    def _load(self) -> dict[str, Any]:
        from .settings_store import SettingsStore

        store = SettingsStore(self.settings)
        return store.merged_license()

    def _packages_path(self) -> Path:
        return self.settings.license_config_path.parent / "license-packages.yml"

    def _load_packages(self) -> dict[str, Any]:
        path = self._packages_path()
        if not path.is_file():
            return {}
        with path.open(encoding="utf-8") as handle:
            return yaml.safe_load(handle) or {}

    def reload(self) -> None:
        self._config = self._load()
        self._packages = self._load_packages()

    def _package_key(self) -> str:
        return str(self._config.get("package") or "unknown").strip()

    def _package_def(self) -> dict[str, Any]:
        packages = self._packages.get("packages") or {}
        return packages.get(self._package_key(), {})

    def enabled_tools(self) -> list[str]:
        explicit = self._config.get("enabled_tools") or []
        if explicit:
            return list(explicit)
        return list(self._package_def().get("enabled_tools") or [])

    def _limits(self) -> dict[str, Any]:
        limits = dict(self._config.get("limits") or {})
        if self._config.get("apply_package_limits", True):
            pkg_limits = self._package_def().get("limits") or {}
            if pkg_limits:
                limits = {**pkg_limits, **limits}
        return limits

    def status(self) -> dict[str, Any]:
        expires = self._config.get("expires_at")
        expired = False
        if expires:
            try:
                exp_dt = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
                expired = exp_dt < datetime.now(timezone.utc)
            except ValueError:
                pass
        pkg = self._package_key()
        pkg_def = self._package_def()
        tools = self.enabled_tools()
        limits = self._limits()
        return {
            "product": self._config.get("product", "SecuriPDF"),
            "package": pkg,
            "packageLabel": pkg_def.get("label", pkg),
            "packageDescription": pkg_def.get("description", ""),
            "version": self._config.get("version", "1.0"),
            "licenseKey": self._config.get("license_key"),
            "expiresAt": expires,
            "expired": expired,
            "limits": limits,
            "enabledTools": tools,
            "enabledToolCount": len(tools),
            "valid": not expired,
        }

    def public_status(self) -> dict[str, Any]:
        data = self.status()
        data.pop("licenseKey", None)
        return data

    def assert_tool_allowed(self, tool_id: str) -> None:
        enabled = self.enabled_tools()
        if enabled and tool_id not in enabled:
            raise HTTPException(status_code=403, detail=f"Lisans paketinde '{tool_id}' araci acik degil")

    def register_session(self, db: Session, user_id: str, session_id: str) -> None:
        limits = self._limits()
        max_sessions = int(limits.get("max_concurrent_sessions", 0))
        if max_sessions <= 0:
            return
        active = db.query(SessionRecord).filter(SessionRecord.user_id == user_id).count()
        if active >= max_sessions:
            raise HTTPException(status_code=403, detail="Es zamanli oturum limiti asildi")
        db.merge(SessionRecord(session_id=session_id, user_id=user_id, started_at=datetime.now(timezone.utc)))
        db.commit()

    def end_session(self, db: Session, session_id: str) -> None:
        db.query(SessionRecord).filter(SessionRecord.session_id == session_id).delete()
        db.commit()
