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
    """Belge/imza/sertifika blob kökü (kullanıcı alt klasörleri buranın altında)."""
    store = SettingsStore(settings)
    override = storage_override(settings)
    backend = storage_backend(settings)
    roots = store.merged_vault().get("storage_roots", {})

    if backend == "shared":
        shared_path = str((override.get("shared") or {}).get("path") or "").strip()
        if shared_path:
            base = Path(shared_path)
            # Shared kök altında standart alt klasörler
            return base

    # local / s3 (s3 blob henüz yerel vault'ta): vault documents_path veya data_path
    doc_root = roots.get("documents", "documents")
    root = Path(str(doc_root))
    if root.is_absolute():
        # documents_path absolut ise onun parent'ı vault kökü olabilir;
        # kind alt yolları resolve_user_dir'de eklenir — burada vault base döndür.
        # Eğer documents_path = /vault-data/documents ise base = /vault-data
        if root.name in ("documents", "archive", "signatures", "certificates"):
            return root.parent
        return root

    local = override.get("local") or {}
    data_path = str(local.get("data_path") or settings.data_path).strip() or str(settings.data_path)
    return Path(data_path)


def resolve_user_dir(settings: Settings, kind: str, user_id: str) -> Path:
    """kind: documents | archive | signatures | certificates."""
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
    root = documents_root(settings)
    note = ""
    blob_mode = "filesystem"
    if backend == "s3":
        blob_mode = "filesystem-deferred"
        note = (
            "S3 baglanti bilgisi kayitli; belge blob'lari su an yerel vault'ta tutulur. "
            "Nesne depolama adapter'i sonraki surumde etkinlestirilecek."
        )
    elif backend == "shared":
        note = "Paylasilan klasor mount yolu kullaniliyor; yazma izni host tarafinda olmali."
    else:
        note = "Belge, imza ve sertifika dosyalari bu kok altinda saklanir."
    return {
        "backend": backend if override.get("configured") else None,
        "configured": bool(override.get("configured")),
        "blobMode": blob_mode,
        "documentsRoot": str(root),
        "note": note,
    }
