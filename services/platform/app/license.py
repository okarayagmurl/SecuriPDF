from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .config import Settings
from .database import SessionRecord


class LicenseService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._config = self._load()

    def _load(self) -> dict[str, Any]:
        from .settings_store import SettingsStore

        store = SettingsStore(self.settings)
        return store.merged_license()

    def reload(self) -> None:
        self._config = self._load()

    def status(self) -> dict[str, Any]:
        expires = self._config.get("expires_at")
        expired = False
        if expires:
            try:
                exp_dt = datetime.fromisoformat(expires.replace("Z", "+00:00"))
                expired = exp_dt < datetime.now(timezone.utc)
            except ValueError:
                pass
        return {
            "product": self._config.get("product", "SecuriPDF"),
            "package": self._config.get("package", "unknown"),
            "version": self._config.get("version", "1.0"),
            "licenseKey": self._config.get("license_key"),
            "expiresAt": expires,
            "expired": expired,
            "limits": self._config.get("limits", {}),
            "enabledTools": self._config.get("enabled_tools", []),
            "valid": not expired,
        }

    def assert_tool_allowed(self, tool_id: str) -> None:
        enabled = self._config.get("enabled_tools") or []
        if enabled and tool_id not in enabled:
            raise HTTPException(status_code=403, detail=f"Lisans paketinde '{tool_id}' araci acik degil")

    def register_session(self, db: Session, user_id: str, session_id: str) -> None:
        limits = self._config.get("limits", {})
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
