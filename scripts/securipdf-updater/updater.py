#!/usr/bin/env python3
"""SecuriPDF host updater agent — localhost HTTP API for offline stack upgrades."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

CONFIG_PATH = Path(os.environ.get("SECURIPDF_UPDATER_CONFIG", "/etc/securipdf/updater.env"))
JOBS_DIR = Path(os.environ.get("SECURIPDF_UPDATER_JOBS", "/var/lib/securipdf/jobs"))
UPLOADS_DIR = Path(os.environ.get("SECURIPDF_UPDATER_UPLOADS", "/var/lib/securipdf/uploads"))
PACKAGES_DIR = Path(os.environ.get("SECURIPDF_UPDATER_PACKAGES", "/var/lib/securipdf/packages"))
LISTEN_HOST = os.environ.get("SECURIPDF_UPDATER_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("SECURIPDF_UPDATER_PORT", "8765"))
CHUNK_SIZE_DEFAULT = 8 * 1024 * 1024  # 8 MiB

_CONFIG: dict[str, str] = {}
_ACTIVE_LOCK = threading.Lock()
_ACTIVE_JOB: str | None = None
_UPLOAD_META: dict[str, dict[str, Any]] = {}


def _load_config() -> dict[str, str]:
    global _CONFIG
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


def _save_config_value(key: str, value: str) -> None:
    cfg = _load_config()
    cfg[key] = value
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"{k}={v}\n" for k, v in sorted(cfg.items())]
    CONFIG_PATH.write_text("".join(lines), encoding="utf-8")
    os.chmod(CONFIG_PATH, 0o600)
    global _CONFIG
    _CONFIG = cfg


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


def _read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
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


def _safe_filename(name: str) -> str:
    base = Path(name or "package.tar.gz").name
    base = base.replace("..", "_").replace("/", "_").replace("\\", "_")
    if not base.lower().endswith((".tar.gz", ".tgz")):
        raise ValueError("Yalnizca .tar.gz / .tgz kabul edilir")
    return base


def _find_existing_env() -> Path | None:
    candidates: list[Path] = []
    try:
        candidates.append(_offline_dir() / "docker" / ".env")
    except RuntimeError:
        pass
    # Yaygın kurulum yolları
    home = Path.home()
    candidates.extend(
        [
            home / "SecuriPDF" / "docker" / ".env",
            home / "securipdf" / "docker" / ".env",
            Path("/opt/securipdf/docker/.env"),
            Path("/opt/SecuriPDF/docker/.env"),
        ]
    )
    # Açık paket dizinleri
    for root in (home, Path("/opt"), PACKAGES_DIR):
        if not root.exists():
            continue
        for env in root.glob("**/docker/.env"):
            candidates.append(env)
            if len(candidates) > 40:
                break
    for path in candidates:
        if path.is_file() and path.stat().st_size > 0:
            return path
    return None


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
        "uploadsDir": str(UPLOADS_DIR),
        "packagesDir": str(PACKAGES_DIR),
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

    add("offline_dir", "Offline kurulum dizini", bool(status.get("offlineDir")), "Web paket yükleme veya updater.env")
    add("docker", "Docker daemon erisimi", status.get("dockerOk") is True, status.get("dockerError") or "")
    add("images_tar", "Image arsivi (images/securipdf-images.tar)", status.get("imagesTarExists") is True, "Paketi web'den yükleyin")
    add("env", "docker/.env mevcut", status.get("envExists") is True, "Mevcut kurulum .env kopyalanmalı")
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


def package_init(filename: str, size: int, sha256: str | None = None) -> dict[str, Any]:
    if size <= 0 or size > 20 * 1024 * 1024 * 1024:
        raise ValueError("Gecersiz paket boyutu")
    safe = _safe_filename(filename)
    upload_id = str(uuid.uuid4())
    dest = UPLOADS_DIR / upload_id
    dest.mkdir(parents=True, exist_ok=True)
    meta = {
        "id": upload_id,
        "filename": safe,
        "size": int(size),
        "sha256": (sha256 or "").strip().lower() or None,
        "received": 0,
        "chunks": {},
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "path": str(dest / safe),
    }
    (dest / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    _UPLOAD_META[upload_id] = meta
    return {
        "ok": True,
        "uploadId": upload_id,
        "chunkSize": CHUNK_SIZE_DEFAULT,
        "filename": safe,
        "size": int(size),
    }


def package_chunk(upload_id: str, index: int, data: bytes) -> dict[str, Any]:
    meta = _UPLOAD_META.get(upload_id)
    if not meta:
        meta_path = UPLOADS_DIR / upload_id / "meta.json"
        if not meta_path.is_file():
            raise ValueError("Upload bulunamadi")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        _UPLOAD_META[upload_id] = meta
    if index < 0:
        raise ValueError("Gecersiz chunk index")
    part = UPLOADS_DIR / upload_id / f"chunk.{index:06d}"
    part.write_bytes(data)
    chunks = meta.setdefault("chunks", {})
    chunks[str(index)] = len(data)
    meta["received"] = sum(int(v) for v in chunks.values())
    (UPLOADS_DIR / upload_id / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return {
        "ok": True,
        "uploadId": upload_id,
        "index": index,
        "received": meta["received"],
        "size": meta["size"],
        "percent": round(100.0 * meta["received"] / max(meta["size"], 1), 2),
    }


def _assemble_and_extract(upload_id: str) -> dict[str, Any]:
    meta_path = UPLOADS_DIR / upload_id / "meta.json"
    if not meta_path.is_file():
        raise ValueError("Upload bulunamadi")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    chunks = meta.get("chunks") or {}
    if not chunks:
        raise ValueError("Hic chunk yok")
    indices = sorted(int(k) for k in chunks.keys())
    expected = list(range(indices[-1] + 1))
    if indices != expected:
        raise ValueError("Eksik chunk var")
    if int(meta.get("received") or 0) != int(meta.get("size") or -1):
        raise ValueError(
            f"Boyut uyusmuyor: received={meta.get('received')} expected={meta.get('size')}"
        )

    tar_path = UPLOADS_DIR / upload_id / meta["filename"]
    h = hashlib.sha256()
    with tar_path.open("wb") as out:
        for i in indices:
            part = UPLOADS_DIR / upload_id / f"chunk.{i:06d}"
            blob = part.read_bytes()
            h.update(blob)
            out.write(blob)
    digest = h.hexdigest()
    expected_sha = (meta.get("sha256") or "").strip().lower()
    if expected_sha and expected_sha != digest:
        raise ValueError("SHA256 dogrulamasi basarisiz")

    PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
    extract_root = PACKAGES_DIR / upload_id
    if extract_root.exists():
        shutil.rmtree(extract_root)
    extract_root.mkdir(parents=True)

    with tarfile.open(tar_path, "r:gz") as tf:
        # Python 3.12+ filter; older ignores
        try:
            tf.extractall(extract_root, filter=tarfile.data_filter)  # type: ignore[arg-type]
        except (AttributeError, TypeError):
            tf.extractall(extract_root)

    # securipdf-*-offline tek üst klasör beklenir
    children = [p for p in extract_root.iterdir() if p.is_dir()]
    if len(children) == 1 and (children[0] / "scripts" / "upgrade-offline-stack.sh").is_file():
        package_dir = children[0]
    elif (extract_root / "scripts" / "upgrade-offline-stack.sh").is_file():
        package_dir = extract_root
    else:
        raise ValueError("Paket icinde upgrade-offline-stack.sh bulunamadi")

    env_src = _find_existing_env()
    env_dst = package_dir / "docker" / ".env"
    env_dst.parent.mkdir(parents=True, exist_ok=True)
    if env_src and env_src.resolve() != env_dst.resolve():
        shutil.copy2(env_src, env_dst)
    elif not env_dst.is_file():
        raise ValueError(
            "Mevcut docker/.env bulunamadi — once en az bir kurulum tamamlanmis olmali"
        )

    _save_config_value("SECURIPDF_OFFLINE_DIR", str(package_dir.resolve()))

    manifest = None
    manifest_path = package_dir / "MANIFEST.json"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = None

    # Chunk temizliği (tar kalsın isteğe bağlı)
    for part in (UPLOADS_DIR / upload_id).glob("chunk.*"):
        part.unlink(missing_ok=True)

    return {
        "ok": True,
        "uploadId": upload_id,
        "sha256": digest,
        "offlineDir": str(package_dir.resolve()),
        "manifest": manifest,
        "envCopiedFrom": str(env_src) if env_src else None,
        "imagesTarExists": (package_dir / "images" / "securipdf-images.tar").is_file(),
    }


def package_complete(upload_id: str) -> dict[str, Any]:
    return _assemble_and_extract(upload_id)


class UpdaterHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def _unauthorized(self) -> bool:
        if not _auth_ok(self.headers):
            _json_response(self, 401, {"ok": False, "error": "Yetkisiz"})
            return True
        return False

    def do_GET(self) -> None:
        if self._unauthorized():
            return
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/health":
            _json_response(self, 200, {"ok": True})
            return
        if path == "/status":
            _json_response(self, 200, collect_status())
            return
        if path.startswith("/jobs/"):
            job_id = path.split("/", 2)[-1]
            job = get_job(job_id)
            if not job:
                _json_response(self, 404, {"ok": False, "error": "Job bulunamadi"})
                return
            _json_response(self, 200, {"ok": True, "job": job})
            return
        _json_response(self, 404, {"ok": False, "error": "Bulunamadi"})

    def do_POST(self) -> None:
        if self._unauthorized():
            return
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            if path == "/preflight":
                _read_json_body(self)
                _json_response(self, 200, run_preflight())
                return
            if path == "/apply":
                _read_json_body(self)
                try:
                    job = start_apply()
                except RuntimeError as exc:
                    _json_response(self, 409, {"ok": False, "error": str(exc)})
                    return
                _json_response(self, 202, {"ok": True, "job": job})
                return
            if path == "/package/init":
                body = _read_json_body(self)
                result = package_init(
                    str(body.get("filename") or ""),
                    int(body.get("size") or 0),
                    str(body.get("sha256") or "") or None,
                )
                _json_response(self, 200, result)
                return
            if path.startswith("/package/") and path.endswith("/complete"):
                upload_id = path.split("/")[2]
                _read_json_body(self)
                result = package_complete(upload_id)
                _json_response(self, 200, result)
                return
        except ValueError as exc:
            _json_response(self, 400, {"ok": False, "error": str(exc)})
            return
        except Exception as exc:
            _json_response(self, 500, {"ok": False, "error": str(exc)})
            return
        _json_response(self, 404, {"ok": False, "error": "Bulunamadi"})

    def do_PUT(self) -> None:
        if self._unauthorized():
            return
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query or "")
        try:
            if path.startswith("/package/") and path.endswith("/chunk"):
                upload_id = path.split("/")[2]
                index = int((qs.get("index") or ["0"])[0])
                length = int(self.headers.get("Content-Length", "0") or 0)
                if length <= 0:
                    raise ValueError("Bos chunk")
                if length > CHUNK_SIZE_DEFAULT * 2:
                    raise ValueError("Chunk cok buyuk")
                data = self.rfile.read(length)
                if len(data) != length:
                    raise ValueError("Chunk eksik okundu")
                result = package_chunk(upload_id, index, data)
                _json_response(self, 200, result)
                return
        except ValueError as exc:
            _json_response(self, 400, {"ok": False, "error": str(exc)})
            return
        except Exception as exc:
            _json_response(self, 500, {"ok": False, "error": str(exc)})
            return
        _json_response(self, 404, {"ok": False, "error": "Bulunamadi"})


def main() -> None:
    _load_config()
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), UpdaterHandler)
    print(f"SecuriPDF updater listening on {LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
