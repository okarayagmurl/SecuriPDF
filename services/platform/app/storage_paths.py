from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import Settings
from .settings_store import SettingsStore


def storage_override(settings: Settings) -> dict[str, Any]:
    return SettingsStore(settings)._override().get("storage") or {}  # noqa: SLF001


def storage_backend(settings: Settings) -> str:
    backend = str(storage_override(settings).get("backend") or "local").strip().lower()
    return backend if backend in ("local", "s3", "shared") else "local"


def documents_root(settings: Settings) -> Path:
    """Filesystem tabanlı blob kökü (local/shared). S3 için anlamlı değil."""
    store = SettingsStore(settings)
    override = storage_override(settings)
    backend = storage_backend(settings)
    roots = store.merged_vault().get("storage_roots", {})

    if backend == "shared":
        shared_path = str((override.get("shared") or {}).get("path") or "").strip()
        if shared_path:
            return Path(shared_path)

    doc_root = roots.get("documents", "documents")
    root = Path(str(doc_root))
    if root.is_absolute():
        if root.name in ("documents", "archive", "signatures", "certificates"):
            return root.parent
        return root

    local = override.get("local") or {}
    data_path = str(local.get("data_path") or settings.data_path).strip() or str(settings.data_path)
    return Path(data_path)


def resolve_user_dir(settings: Settings, kind: str, user_id: str) -> Path:
    """kind: documents | archive | signatures | certificates (yalnizca FS backend)."""
    roots = SettingsStore(settings).merged_vault().get("storage_roots", {})
    root_name = str(roots.get(kind, kind))
    named = Path(root_name)
    if named.is_absolute():
        path = named / user_id
    else:
        path = documents_root(settings) / root_name / user_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def storage_runtime_info(settings: Settings) -> dict[str, Any]:
    override = storage_override(settings)
    backend = storage_backend(settings)
    note = ""
    blob_mode = "filesystem"
    documents_root_display = ""

    if backend == "s3":
        blob_mode = "s3"
        s3 = override.get("s3") or {}
        endpoint = str(s3.get("endpoint") or "")
        bucket = str(s3.get("bucket") or "")
        prefix = str(s3.get("prefix") or "")
        documents_root_display = f"s3://{bucket}/{prefix}".rstrip("/")
        note = (
            f"Belge dosyalari S3/MinIO'ya yazilir ({endpoint or 'aws'}). "
            "Erisilemezse yukleme/indirme 503 doner; sessizce yerele dusulmez. "
            "Metadata SQLite yerel kalir."
        )
    elif backend == "shared":
        root = documents_root(settings)
        documents_root_display = str(root)
        note = (
            "Paylaşılan klasör = container icinden gorunen yol "
            "(host SMB/NFS mount + docker volume bind). "
            "Yol yoksa veya yazilamazsa kayit ve belge islemleri reddedilir."
        )
    else:
        root = documents_root(settings)
        documents_root_display = str(root)
        blob_mode = "filesystem"
        note = "Belge, imza ve sertifika dosyalari bu kok altinda saklanir."

    return {
        "backend": backend if override.get("configured") else None,
        "configured": bool(override.get("configured")),
        "blobMode": blob_mode,
        "documentsRoot": documents_root_display,
        "note": note,
    }
