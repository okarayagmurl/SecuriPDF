from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


class UpdaterError(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def _base_url() -> str:
    return os.getenv("SECURIPDF_UPDATER_URL", "http://host.docker.internal:8765").rstrip("/")


def _token() -> str:
    return os.getenv("SECURIPDF_UPDATER_TOKEN", "").strip()


def updater_configured() -> bool:
    return bool(_token())


def _request(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    if not updater_configured():
        raise UpdaterError("SECURIPDF_UPDATER_TOKEN tanimli degil")
    url = f"{_base_url()}{path}"
    data = None
    headers = {
        "Authorization": f"Bearer {_token()}",
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(detail)
            msg = payload.get("error") or detail
        except json.JSONDecodeError:
            msg = detail or exc.reason
        raise UpdaterError(str(msg).strip(), status=exc.code) from exc
    except urllib.error.URLError as exc:
        raise UpdaterError(f"Updater ulasilamadi: {exc.reason}") from exc


def updater_health() -> dict[str, Any]:
    if not updater_configured():
        return {"configured": False, "reachable": False, "error": "Token yok"}
    try:
        _request("GET", "/health")
        status = _request("GET", "/status")
        return {"configured": True, "reachable": True, "status": status}
    except UpdaterError as exc:
        return {"configured": True, "reachable": False, "error": str(exc)}


def updater_preflight() -> dict[str, Any]:
    return _request("POST", "/preflight")


def updater_apply() -> dict[str, Any]:
    payload = _request("POST", "/apply")
    return payload.get("job") or payload


def updater_get_job(job_id: str) -> dict[str, Any]:
    payload = _request("GET", f"/jobs/{job_id}")
    return payload.get("job") or payload
