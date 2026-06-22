from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from .config import Settings
from .database import CertificateRecord, DocumentRecord, SignatureRecord, utcnow


def purge_soft_deleted(db: Session, settings: Settings, soft_delete_days: int = 30) -> int:
    """Soft-delete edilmis kayitlari ve dosyalarini kalici olarak temizler."""
    cutoff = utcnow() - timedelta(days=soft_delete_days)
    removed = 0

    for model in (DocumentRecord, SignatureRecord, CertificateRecord):
        rows = db.query(model).filter(
            model.deleted_at.isnot(None),
            model.deleted_at < cutoff,
        ).all()
        for row in rows:
            storage = Path(row.storage_path)
            if storage.exists():
                storage.unlink(missing_ok=True)
            db.delete(row)
            removed += 1

    if removed:
        db.commit()
    return removed


def load_tools_config(settings: Settings) -> dict:
    base_path = Path("/config/tools.yml")
    data: dict = {}
    if base_path.exists():
        import yaml

        with base_path.open(encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}

    override_path = settings.data_path / "config" / "tools.override.yml"
    if override_path.exists():
        import yaml

        with override_path.open(encoding="utf-8") as handle:
            override = yaml.safe_load(handle) or {}
        if "enabled" in override:
            data["enabled"] = override["enabled"]
        if "ui" in override:
            data["ui"] = {**(data.get("ui") or {}), **override["ui"]}
    return data


def save_tools_override(settings: Settings, enabled: list[str]) -> Path:
    import yaml

    override_path = settings.data_path / "config" / "tools.override.yml"
    override_path.parent.mkdir(parents=True, exist_ok=True)
    with override_path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump({"enabled": enabled}, handle, allow_unicode=True, default_flow_style=False)
    return override_path
