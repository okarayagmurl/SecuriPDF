from __future__ import annotations

import base64
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException

from .config import Settings
from .crypto_util import decrypt_bytes
from .storage_paths import documents_root, resolve_user_dir, storage_backend, storage_override

UNREACHABLE = (
    "Belge depolama alanina erisilemiyor. "
    "Yapilandirmayi (Admin → Belge depolama) ve ag/mount durumunu kontrol edin."
)


class StorageUnavailable(HTTPException):
    def __init__(self, detail: str | None = None):
        super().__init__(status_code=503, detail=detail or UNREACHABLE)


def _s3_cfg(settings: Settings) -> dict[str, Any]:
    return dict(storage_override(settings).get("s3") or {})


def _s3_secret(settings: Settings) -> str:
    enc = str(_s3_cfg(settings).get("secret_key_enc") or "")
    if not enc:
        raise StorageUnavailable("S3 secret_key tanimli degil")
    raw = base64.b64decode(enc.encode("ascii"))
    return decrypt_bytes(settings.master_key, raw).decode("utf-8")


def _s3_client(settings: Settings):
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise StorageUnavailable("S3 icin boto3 yuklu degil (image yeniden build edilmeli)") from exc

    cfg = _s3_cfg(settings)
    endpoint = str(cfg.get("endpoint") or "").rstrip("/")
    region = str(cfg.get("region") or "us-east-1") or "us-east-1"
    return boto3.client(
        "s3",
        endpoint_url=endpoint or None,
        aws_access_key_id=str(cfg.get("access_key") or ""),
        aws_secret_access_key=_s3_secret(settings),
        region_name=region,
        config=Config(
            s3={"addressing_style": "path"},
            connect_timeout=5,
            read_timeout=30,
            retries={"max_attempts": 2},
        ),
    )


def is_s3_ref(ref: str) -> bool:
    return str(ref or "").startswith("s3://")


def make_blob_ref(settings: Settings, kind: str, user_id: str, filename: str) -> str:
    if storage_backend(settings) == "s3":
        cfg = _s3_cfg(settings)
        bucket = str(cfg.get("bucket") or "").strip()
        if not bucket:
            raise StorageUnavailable("S3 bucket tanimli degil")
        prefix = str(cfg.get("prefix") or "").strip().strip("/")
        parts = [p for p in (prefix, kind, user_id, filename) if p]
        return f"s3://{bucket}/{'/'.join(parts)}"
    return str(resolve_user_dir(settings, kind, user_id) / filename)


def _parse_s3(ref: str) -> tuple[str, str]:
    parsed = urlparse(ref)
    if parsed.scheme != "s3" or not parsed.netloc:
        raise ValueError(f"Gecersiz S3 ref: {ref}")
    key = parsed.path.lstrip("/")
    if not key:
        raise ValueError(f"Gecersiz S3 key: {ref}")
    return parsed.netloc, key


def blob_write(settings: Settings, ref: str, data: bytes) -> None:
    if is_s3_ref(ref):
        bucket, key = _parse_s3(ref)
        try:
            _s3_client(settings).put_object(Bucket=bucket, Key=key, Body=data)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise StorageUnavailable(f"{UNREACHABLE} (S3 yazma: {exc})") from exc
        return
    try:
        path = Path(ref)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError as exc:
        raise StorageUnavailable(f"{UNREACHABLE} (yazma: {exc})") from exc


def blob_read(settings: Settings, ref: str) -> bytes:
    if is_s3_ref(ref):
        bucket, key = _parse_s3(ref)
        try:
            resp = _s3_client(settings).get_object(Bucket=bucket, Key=key)
            return resp["Body"].read()
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise StorageUnavailable(f"{UNREACHABLE} (S3 okuma: {exc})") from exc
    try:
        path = Path(ref)
        if not path.is_file():
            raise StorageUnavailable("Depolama dosyasi bulunamadi veya alana erisilemiyor")
        return path.read_bytes()
    except OSError as exc:
        raise StorageUnavailable(f"{UNREACHABLE} (okuma: {exc})") from exc


def blob_exists(settings: Settings, ref: str) -> bool:
    if is_s3_ref(ref):
        bucket, key = _parse_s3(ref)
        try:
            _s3_client(settings).head_object(Bucket=bucket, Key=key)
            return True
        except Exception:  # noqa: BLE001
            return False
    try:
        return Path(ref).is_file()
    except OSError:
        return False


def blob_delete(settings: Settings, ref: str) -> None:
    if is_s3_ref(ref):
        bucket, key = _parse_s3(ref)
        try:
            _s3_client(settings).delete_object(Bucket=bucket, Key=key)
        except Exception:  # noqa: BLE001
            pass
        return
    try:
        Path(ref).unlink(missing_ok=True)
    except OSError:
        pass


def blob_move(settings: Settings, src: str, dest: str) -> None:
    data = blob_read(settings, src)
    blob_write(settings, dest, data)
    if src != dest:
        blob_delete(settings, src)


def probe_filesystem(root: Path, *, require_exists: bool = True) -> None:
    try:
        if require_exists and not root.exists():
            raise StorageUnavailable(
                f"Depolama yolu yok veya container icinden gorunmuyor: {root}. "
                "Shared kullanıyorsanız host mount + docker volume bind gerekir."
            )
        root.mkdir(parents=True, exist_ok=True)
        if not root.is_dir():
            raise StorageUnavailable(f"Depolama yolu dizin degil: {root}")
        probe = root / ".securipdf-write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except StorageUnavailable:
        raise
    except OSError as exc:
        raise StorageUnavailable(f"{UNREACHABLE} (yol: {root}, hata: {exc})") from exc


def probe_s3(settings: Settings) -> None:
    cfg = _s3_cfg(settings)
    bucket = str(cfg.get("bucket") or "").strip()
    if not bucket:
        raise HTTPException(status_code=400, detail="S3 bucket zorunlu")
    try:
        client = _s3_client(settings)
        prefix = str(cfg.get("prefix") or "").strip().strip("/")
        key = "/".join(p for p in (prefix, ".securipdf-write-test") if p)
        client.put_object(Bucket=bucket, Key=key, Body=b"ok")
        client.delete_object(Bucket=bucket, Key=key)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"S3 erisim testi basarisiz: {exc}") from exc


def check_storage_health(settings: Settings) -> dict[str, Any]:
    """Admin/setup icin erisilebilirlik ozeti — sessiz yerel fallback yok."""
    backend = storage_backend(settings)
    override = storage_override(settings)
    result: dict[str, Any] = {
        "backend": backend,
        "configured": bool(override.get("configured")),
        "reachable": False,
        "error": None,
    }
    if not result["configured"]:
        result["error"] = "Depolama yapilandirilmamis"
        return result
    try:
        if backend == "s3":
            probe_s3(settings)
            s3 = override.get("s3") or {}
            result["target"] = f"s3://{s3.get('bucket')}/{s3.get('prefix') or ''}".rstrip("/")
        else:
            root = documents_root(settings)
            probe_filesystem(root, require_exists=(backend == "shared"))
            result["target"] = str(root)
        result["reachable"] = True
    except HTTPException as exc:
        result["error"] = str(exc.detail)
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)
    return result


def require_storage_writable(settings: Settings) -> None:
    """Yukleme/arsiv oncesi — erisilemezse 503."""
    health = check_storage_health(settings)
    if not health.get("reachable"):
        raise StorageUnavailable(health.get("error") or UNREACHABLE)
