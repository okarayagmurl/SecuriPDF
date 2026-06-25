from __future__ import annotations

import json
import secrets
from pathlib import Path

from .auth import encrypt_bytes, decrypt_bytes, new_guid
from .config import Settings


def new_ref_id() -> str:
    return new_guid()


def _labels_path(settings: Settings, user_id: str) -> Path:
    path = settings.data_path / "job-labels" / user_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_label(settings: Settings, user_id: str, ref_id: str, label: str) -> None:
    path = _labels_path(settings, user_id) / f"{ref_id}.enc"
    payload = json.dumps({"label": label}, ensure_ascii=False).encode("utf-8")
    path.write_bytes(encrypt_bytes(settings, payload))


def load_labels(settings: Settings, user_id: str, ref_ids: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    base = _labels_path(settings, user_id)
    for ref_id in ref_ids:
        path = base / f"{ref_id}.enc"
        if not path.is_file():
            continue
        try:
            raw = decrypt_bytes(settings, path.read_bytes())
            data = json.loads(raw.decode("utf-8"))
            if isinstance(data.get("label"), str):
                out[ref_id] = data["label"]
        except (ValueError, json.JSONDecodeError, OSError):
            continue
    return out
