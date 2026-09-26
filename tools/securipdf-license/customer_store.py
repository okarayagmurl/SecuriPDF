"""Entera License Manager — yerel musteri kayit deposu (JSON)."""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def default_store_path() -> Path:
    # Exe yaninda veya gelistirme dizininde
    base = Path(__file__).resolve().parent
    return base / "data" / "customers.json"


class CustomerStore:
    def __init__(self, path: Path | None = None):
        self.path = path or default_store_path()

    def _load(self) -> dict[str, Any]:
        if not self.path.is_file():
            return {"version": 1, "customers": []}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _save(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def list(self) -> list[dict[str, Any]]:
        return list(self._load().get("customers") or [])

    def get(self, customer_id: str) -> dict[str, Any] | None:
        for c in self.list():
            if c.get("id") == customer_id:
                return c
        return None

    def find_by_name(self, name: str) -> dict[str, Any] | None:
        needle = name.strip().lower()
        for c in self.list():
            if str(c.get("name") or "").strip().lower() == needle:
                return c
        return None

    def add(
        self,
        *,
        name: str,
        contact_email: str = "",
        contact_name: str = "",
        notes: str = "",
        default_package: str = "professional",
    ) -> dict[str, Any]:
        name = name.strip()
        if len(name) < 2:
            raise ValueError("Musteri adi zorunlu")
        if self.find_by_name(name):
            raise ValueError(f"Musteri zaten kayitli: {name}")
        data = self._load()
        cust = {
            "id": f"CUST-{uuid.uuid4().hex[:10].upper()}",
            "name": name,
            "contact_email": contact_email.strip(),
            "contact_name": contact_name.strip(),
            "notes": notes.strip(),
            "default_package": default_package.strip() or "professional",
            "created_at": _now(),
            "installations": [],
            "licenses": [],
        }
        data.setdefault("customers", []).append(cust)
        self._save(data)
        return cust

    def record_license(
        self,
        customer_id: str,
        *,
        installation_id: str,
        request_id: str,
        package: str,
        license_key: str,
        expires_at: str | None,
        lic_path: str,
    ) -> dict[str, Any]:
        data = self._load()
        for cust in data.get("customers") or []:
            if cust.get("id") != customer_id:
                continue
            installs = cust.setdefault("installations", [])
            if installation_id and installation_id not in installs:
                installs.append(installation_id)
            entry = {
                "license_key": license_key,
                "request_id": request_id,
                "installation_id": installation_id,
                "package": package,
                "expires_at": expires_at,
                "issued_at": _now(),
                "file": lic_path,
                "id": f"LIC-{secrets.token_hex(4).upper()}",
            }
            cust.setdefault("licenses", []).append(entry)
            self._save(data)
            return entry
        raise ValueError(f"Musteri bulunamadi: {customer_id}")
