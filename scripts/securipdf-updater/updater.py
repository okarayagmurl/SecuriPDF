#!/usr/bin/env python3
"""SecuriPDF host updater agent — localhost HTTP API for offline stack upgrades."""
from __future__ import annotations

import json
import os
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

CONFIG_PATH = Path(os.environ.get("SECURIPDF_UPDATER_CONFIG", "/etc/securipdf/updater.env"))
JOBS_DIR = Path(os.environ.get("SECURIPDF_UPDATER_JOBS", "/var/lib/securipdf/jobs"))
LISTEN_HOST = os.environ.get("SECURIPDF_UPDATER_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("SECURIPDF_UPDATER_PORT", "8765"))

_CONFIG: dict[str, str] = {}
_ACTIVE_LOCK = threading.Lock()
_ACTIVE_JOB: str | None = None


def _load_config() -> dict[str, str]:
    global _CONFIG
    if _CONFIG:
        return _CONFIG
    data: dict[str, str] = {}
    if CONFIG_PATH.exists():
        for line in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            data[key.strip()] = val.strip().strip('"')
    for key in ("SECURIPDF_OFFLINE_DIR", "SECURIPDF_UPDATER_TOKEN"):
        if os.environ.get(key):
            data[key] = os.environ[key]
    _CONFIG = data
    return data


def _offline_dir() -> Path:
    cfg = _load_config()
    raw = cfg.get("SECURIPDF_OFFLINE_DIR", "")
    if not raw:
        raise RuntimeError("SECURIPDF_OFFLINE_DIR tanimli degil")
    return Path(raw)


def _auth_ok(headers) -> bool:
    token = _load_config().get("SECURIPDF_UPDATER_TOKEN", "")
    if not token:
        return False
    auth = headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip() == token
    return headers.get("X-SecuriPDF-Updater-Token", "").strip() == token


def _json_response(handler: BaseHTTPRequestHandler, code: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("Gecersiz JSON") from exc
    return data if isinstance(data, dict) else {}


def _run(cmd: list[str], cwd: Path | None = None) -> tuple[int, str]:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        check=False,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out


def _job_path(job_id: str) -> Path:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    return JOBS_DIR / f"{job_id}.json"


def _log_path(job_id: str) -> Path:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    return JOBS_DIR / f"{job_id}.log"


def _write_job(job: dict[str, Any]) -> None:
    path = _job_path(job["id"])
    path.write_text(json.dumps(job, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _read_job(job_id: str) -> dict[str, Any] | None:
    path = _job_path(job_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _append_log(job_id: str, line: str) -> None:
    with _log_path(job_id).open("a", encoding="utf-8") as fh:
        fh.write(line)
        if not line.endswith("\n"):
            fh.write("\n")


def _tail_log(job_id: str, max_lines: int = 200) -> list[str]:
    path = _log_path(job_id)
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return lines[-max_lines:]


def collect_status() -> dict[str, Any]:
    cfg = _load_config()
    offline = cfg.get("SECURIPDF_OFFLINE_DIR", "")
    root = Path(offline) if offline else None
    docker_ok = False
    docker_err = ""
    code, out = _run(["docker", "info"])
    if code == 0:
        docker_ok = True
    else:
        docker_err = out.strip()[:500]

    images_tar = root / "images/securipdf-images.tar" if root else None
    env_file = root / "docker/.env" if root else None
    upgrade_script = root / "scripts/upgrade-offline-stack.sh" if root else None

    return {
        "ok": True,
        "offlineDir": str(root) if root else None,
        "dockerOk": docker_ok,
        "dockerError": docker_err or None,
        "imagesTarExists": bool(images_tar and images_tar.is_file()),
        "envExists": bool(env_file and env_file.is_file()),
        "upgradeScriptExists": bool(upgrade_script and upgrade_script.is_file()),
        "activeJobId": _ACTIVE_JOB,
        "listen": f"{LISTEN_HOST}:{LISTEN_PORT}",
    }


def run_preflight() -> dict[str, Any]:
    status = collect_status()
    checks: list[dict[str, Any]] = []
    ok = True

    def add(cid: str, label: str, passed: bool, hint: str = "") -> None:
        nonlocal ok
        if not passed:
            ok = False
        checks.append({"id": cid, "label": label, "ok": passed, "hint": hint})

    add("offline_dir", "Offline kurulum dizini", bool(status.get("offlineDir")), "installer veya updater.env")
    add("docker", "Docker daemon erisimi", status.get("dockerOk") is True, status.get("dockerError") or "")
    add("images_tar", "Image arsivi (images/securipdf-images.tar)", status.get("imagesTarExists") is True, "Yeni paketi offline dizine acin")
    add("env", "docker/.env mevcut", status.get("envExists") is True, "")
    add("upgrade_script", "upgrade-offline-stack.sh", status.get("upgradeScriptExists") is True, "")

    root = _offline_dir() if status.get("offlineDir") else None
    if root and (root / "docker/.env").is_file():
        code, out = _run(["bash", str(root / "docker/verify-auth-urls.sh")], cwd=root / "docker")
        add("auth_urls", "OAuth erisim URL dogrulama", code == 0, out.strip()[:240] if code != 0 else "")

    return {"ok": ok, "checks": checks, "status": status}


def _run_upgrade_job(job_id: str) -> None:
    global _ACTIVE_JOB
    job = _read_job(job_id) or {"id": job_id}
    job["status"] = "running"
    job["startedAt"] = datetime.now(timezone.utc).isoformat()
    _write_job(job)

    root = _offline_dir()
    script = root / "scripts/upgrade-offline-stack.sh"
    _append_log(job_id, f"[updater] Baslatildi: {script}")

    try:
        proc = subprocess.Popen(
            ["bash", str(script)],
            cwd=str(root),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env={**os.environ, "SECURIPDF_UPDATER_SKIP_INSTALL": "1"},
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            _append_log(job_id, line.rstrip("\n"))
        code = proc.wait()
        job = _read_job(job_id) or job
        job["exitCode"] = code
        job["finishedAt"] = datetime.now(timezone.utc).isoformat()
        if code == 0:
            job["status"] = "succeeded"
            _append_log(job_id, "[updater] Tamamlandi.")
        else:
            job["status"] = "failed"
            _append_log(job_id, f"[updater] Hata: cikis kodu {code}")
        _write_job(job)
    except Exception as exc:
        job = _read_job(job_id) or job
        job["status"] = "failed"
        job["finishedAt"] = datetime.now(timezone.utc).isoformat()
        job["error"] = str(exc)
        _append_log(job_id, f"[updater] Istisna: {exc}")
        _write_job(job)
    finally:
        with _ACTIVE_LOCK:
            if _ACTIVE_JOB == job_id:
                _ACTIVE_JOB = None


def start_apply() -> dict[str, Any]:
    global _ACTIVE_JOB
    pre = run_preflight()
    if not pre.get("ok"):
        raise RuntimeError("On kontrol basarisiz")

    with _ACTIVE_LOCK:
        if _ACTIVE_JOB:
            raise RuntimeError(f"Baska bir guncelleme calisiyor: {_ACTIVE_JOB}")

        job_id = str(uuid.uuid4())
        _ACTIVE_JOB = job_id
        job = {
            "id": job_id,
            "status": "pending",
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "targetOfflineDir": str(_offline_dir()),
        }
        _write_job(job)
        _log_path(job_id).write_text("", encoding="utf-8")

    thread = threading.Thread(target=_run_upgrade_job, args=(job_id,), daemon=True)
    thread.start()
    return job


def get_job(job_id: str) -> dict[str, Any] | None:
    job = _read_job(job_id)
    if not job:
        return None
    job = dict(job)
    job["log"] = _tail_log(job_id)
    return job


class UpdaterHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def _route(self) -> None:
        if not _auth_ok(self.headers):
            _json_response(self, 401, {"ok": False, "error": "Yetkisiz"})
            return

        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if self.command == "GET" and path == "/health":
            _json_response(self, 200, {"ok": True})
            return
        if self.command == "GET" and path == "/status":
            _json_response(self, 200, collect_status())
            return
        if self.command == "POST" and path == "/preflight":
            _json_response(self, 200, run_preflight())
            return
        if self.command == "POST" and path == "/apply":
            try:
                job = start_apply()
            except RuntimeError as exc:
                _json_response(self, 409, {"ok": False, "error": str(exc)})
                return
            _json_response(self, 202, {"ok": True, "job": job})
            return
        if self.command == "GET" and path.startswith("/jobs/"):
            job_id = path.split("/", 2)[-1]
            job = get_job(job_id)
            if not job:
                _json_response(self, 404, {"ok": False, "error": "Job bulunamadi"})
                return
            _json_response(self, 200, {"ok": True, "job": job})
            return

        _json_response(self, 404, {"ok": False, "error": "Bulunamadi"})

    def do_GET(self) -> None:
        self._route()

    def do_POST(self) -> None:
        try:
            _read_json(self)
        except ValueError as exc:
            _json_response(self, 400, {"ok": False, "error": str(exc)})
            return
        self._route()


def main() -> None:
    _load_config()
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), UpdaterHandler)
    print(f"SecuriPDF updater listening on {LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
