from __future__ import annotations

import base64
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException

from .audit import write_audit
from .config import Settings
from .crypto_util import encrypt_bytes
from .settings_store import SettingsStore
from .updater_client import UpdaterError, updater_configured


SETUP_FLAG = "config/setup-complete.flag"
STORAGE_BACKENDS = ("local", "s3", "shared")


def setup_flag_path(settings: Settings) -> Path:
    return settings.data_path / SETUP_FLAG


def is_setup_complete(settings: Settings) -> bool:
    if setup_flag_path(settings).is_file():
        return True
    store = SettingsStore(settings)
    return bool(store.merged_deployment().get("setup_wizard_completed"))


def ensure_legacy_setup_complete(settings: Settings) -> bool:
    """Onceki surumden gelen kurulumlari first-run disinda tut.

    Not: init_db'den ONCE cagrilmali — taze olusturulan metadata.db legacy degildir.
    Yalnizca gercek kullanim izleri (belge/job/backup veya admin-settings) sayilir.
    """
    if is_setup_complete(settings):
        return True
    legacy = False
    try:
        for extra in (
            settings.data_path / "jobs",
            settings.data_path / "backups",
            settings.data_path / "documents",
        ):
            if extra.exists() and (extra.is_file() or any(extra.iterdir())):
                legacy = True
                break
        admin_yml = settings.data_path / "config" / "admin-settings.yml"
        if admin_yml.is_file() and admin_yml.stat().st_size > 0:
            legacy = True
    except OSError:
        pass
    if not legacy:
        return False
    mark_setup_complete(settings, actor="legacy-migrate")
    return True


def mark_setup_complete(settings: Settings, actor: str = "setup") -> None:
    flag = setup_flag_path(settings)
    flag.parent.mkdir(parents=True, exist_ok=True)
    flag.write_text(datetime.now(timezone.utc).isoformat() + "\n", encoding="utf-8")
    store = SettingsStore(settings)
    store.update_section(
        "deployment",
        {
            "setup_wizard_completed": True,
            "setup_wizard_completed_at": datetime.now(timezone.utc).isoformat(),
        },
        actor,
    )
    write_audit(settings, actor, "setup.complete", "wizard", {})


def get_storage_config(settings: Settings) -> dict[str, Any]:
    store = SettingsStore(settings)
    override = store._override()  # noqa: SLF001
    storage = override.get("storage") or {}
    backend = str(storage.get("backend") or "").strip().lower()
    from .storage_paths import storage_runtime_info

    runtime = storage_runtime_info(settings)
    return {
        "backend": backend or None,
        "configured": bool(storage.get("configured")) and backend in STORAGE_BACKENDS,
        "local": storage.get("local") or {"data_path": str(settings.data_path), "db_path": str(settings.db_path)},
        "s3": {
            "endpoint": (storage.get("s3") or {}).get("endpoint", ""),
            "bucket": (storage.get("s3") or {}).get("bucket", ""),
            "region": (storage.get("s3") or {}).get("region", ""),
            "prefix": (storage.get("s3") or {}).get("prefix", ""),
            "access_key": (storage.get("s3") or {}).get("access_key", ""),
            "has_secret": bool((storage.get("s3") or {}).get("secret_key_enc")),
        },
        "shared": {
            "host": (storage.get("shared") or {}).get("host", ""),
            "share": (storage.get("shared") or {}).get("share", ""),
            "path": (storage.get("shared") or {}).get("path", ""),
            "username": (storage.get("shared") or {}).get("username", ""),
            "domain": (storage.get("shared") or {}).get("domain", ""),
            "has_password": bool((storage.get("shared") or {}).get("password_enc")),
            "mode": (
                "smb"
                if (storage.get("shared") or {}).get("host") and (storage.get("shared") or {}).get("share")
                else ("path" if (storage.get("shared") or {}).get("path") else None)
            ),
        },
        "runtime": runtime,
        "health": None,
    }


def get_setup_status(settings: Settings) -> dict[str, Any]:
    storage = get_storage_config(settings)
    store = SettingsStore(settings)
    dep = store.merged_deployment()
    default_user = (store._override().get("setup") or {}).get("default_user") or {}  # noqa: SLF001
    return {
        "complete": is_setup_complete(settings),
        "storageConfigured": bool(storage.get("configured")),
        "defaultUserCreated": bool(default_user.get("created")),
        "defaultUsername": default_user.get("username") or None,
        "storage": storage,
        "canFinish": bool(storage.get("configured")) and bool(default_user.get("created")),
        "wizardCompletedAt": dep.get("setup_wizard_completed_at"),
    }


def save_storage_config(settings: Settings, payload: dict[str, Any], actor: str = "setup") -> dict[str, Any]:
    backend = str(payload.get("backend") or "").strip().lower()
    if backend not in STORAGE_BACKENDS:
        raise HTTPException(status_code=400, detail="backend: local, s3 veya shared olmali")

    store = SettingsStore(settings)
    data = store._override()  # noqa: SLF001
    prev_storage = data.get("storage")
    storage: dict[str, Any] = {"backend": backend, "configured": True}

    if backend == "local":
        data_path = str(payload.get("data_path") or settings.data_path).strip() or str(settings.data_path)
        db_path = str(payload.get("db_path") or "").strip() or str(Path(data_path) / "metadata.db")
        root = Path(data_path)
        try:
            root.mkdir(parents=True, exist_ok=True)
            probe = root / ".securipdf-write-test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
        except OSError as exc:
            raise HTTPException(status_code=400, detail=f"Local path yazilabilir degil: {exc}") from exc
        storage["local"] = {"data_path": data_path, "db_path": db_path}
        # Vault documents override (platform restart sonrasi tam etki)
        vault = data.setdefault("vault", {})
        vault["documents_path"] = str(Path(data_path) / "documents")

    elif backend == "s3":
        endpoint = str(payload.get("endpoint") or "").strip()
        bucket = str(payload.get("bucket") or "").strip()
        access_key = str(payload.get("access_key") or "").strip()
        secret_key = str(payload.get("secret_key") or "").strip()
        if not endpoint or not bucket or not access_key:
            raise HTTPException(status_code=400, detail="S3 endpoint, bucket ve access_key zorunlu")
        s3: dict[str, Any] = {
            "endpoint": endpoint.rstrip("/"),
            "bucket": bucket,
            "region": str(payload.get("region") or "").strip(),
            "prefix": str(payload.get("prefix") or "").strip(),
            "access_key": access_key,
        }
        if secret_key:
            s3["secret_key_enc"] = base64.b64encode(
                encrypt_bytes(settings.master_key, secret_key.encode("utf-8"))
            ).decode("ascii")
        elif (data.get("storage") or {}).get("s3", {}).get("secret_key_enc"):
            s3["secret_key_enc"] = data["storage"]["s3"]["secret_key_enc"]
        else:
            raise HTTPException(status_code=400, detail="S3 secret_key zorunlu")
        storage["s3"] = s3
        # Gecici olarak kaydetmeden once erisim testi — once override'a yaz
        data["storage"] = storage
        store._save_override(data)  # noqa: SLF001
        try:
            from .blob_store import probe_s3

            probe_s3(settings)
        except Exception:
            # Basarisizsa onceki storage'i geri koy
            data["storage"] = prev_storage
            store._save_override(data)  # noqa: SLF001
            raise

    else:  # shared — SMB (tercih) veya eski container path
        host = str(payload.get("host") or payload.get("smb_host") or "").strip()
        share = str(payload.get("share") or payload.get("smb_share") or "").strip()
        path = str(payload.get("path") or "").strip()
        username = str(payload.get("username") or "").strip()
        domain = str(payload.get("domain") or "").strip()
        password = str(payload.get("password") or "").strip()

        shared: dict[str, Any] = {}
        prev_shared = (data.get("storage") or {}).get("shared") or {}

        if host and share:
            if not username:
                raise HTTPException(status_code=400, detail="SMB kullanici adi zorunlu")
            shared = {
                "host": host,
                "share": share,
                "path": path,
                "username": username,
                "domain": domain,
            }
            if password:
                shared["password_enc"] = base64.b64encode(
                    encrypt_bytes(settings.master_key, password.encode("utf-8"))
                ).decode("ascii")
            elif prev_shared.get("password_enc"):
                shared["password_enc"] = prev_shared["password_enc"]
            else:
                raise HTTPException(status_code=400, detail="SMB parola zorunlu")
            storage["shared"] = shared
            data["storage"] = storage
            store._save_override(data)  # noqa: SLF001
            try:
                from .smb_store import probe_smb

                probe_smb(settings)
            except Exception:
                data["storage"] = prev_storage
                store._save_override(data)  # noqa: SLF001
                raise
        elif path:
            # Geriye uyumluluk: container ici mount yolu
            shared = {
                "path": path,
                "username": username,
            }
            if password:
                shared["password_enc"] = base64.b64encode(
                    encrypt_bytes(settings.master_key, password.encode("utf-8"))
                ).decode("ascii")
            elif prev_shared.get("password_enc"):
                shared["password_enc"] = prev_shared["password_enc"]
            from .blob_store import probe_filesystem

            try:
                probe_filesystem(Path(path), require_exists=True)
            except HTTPException as exc:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{exc.detail} Tercih: SMB sunucu+paylasim+kullanici/parola "
                        "(host mount gerekmez)."
                    ),
                ) from exc
            storage["shared"] = shared
            vault = data.setdefault("vault", {})
            vault["documents_path"] = str(Path(path) / "documents")
            vault["archive_path"] = str(Path(path) / "archive")
        else:
            raise HTTPException(
                status_code=400,
                detail="SMB icin host+share+kullanici+parola veya (eski) container path gerekli",
            )

    data["storage"] = storage
    store._save_override(data)  # noqa: SLF001
    write_audit(settings, actor, "setup.storage.save", backend, {"backend": backend})
    return get_storage_config(settings)


def _keycloak_admin() -> tuple[str, str, str, str]:
    base = os.getenv("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080").rstrip("/")
    user = os.getenv("KEYCLOAK_ADMIN", "admin")
    password = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "")
    realm = os.getenv("KEYCLOAK_REALM", "securipdf")
    if not password:
        raise HTTPException(status_code=503, detail="KEYCLOAK_ADMIN_PASSWORD tanimli degil")
    return base, user, password, realm


def create_default_user(
    settings: Settings,
    *,
    username: str,
    password: str,
    email: str | None = None,
    actor: str = "setup",
) -> dict[str, Any]:
    username = username.strip()
    password = password.strip()
    if not re.fullmatch(r"[a-zA-Z0-9._-]{3,64}", username):
        raise HTTPException(status_code=400, detail="Kullanici adi 3-64 karakter, harf/rakam/._-")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Parola en az 8 karakter olmali")
    email = (email or f"{username}@local").strip()

    base, admin_user, admin_password, realm = _keycloak_admin()
    with httpx.Client(timeout=30.0) as client:
        token_resp = client.post(
            f"{base}/realms/master/protocol/openid-connect/token",
            data={
                "client_id": "admin-cli",
                "username": admin_user,
                "password": admin_password,
                "grant_type": "password",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Keycloak token alinamadi: {token_resp.text[:200]}")
        token = token_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Find existing
        found = client.get(
            f"{base}/admin/realms/{realm}/users",
            params={"username": username, "exact": "true"},
            headers=headers,
        )
        user_id = None
        if found.status_code == 200 and found.json():
            user_id = found.json()[0].get("id")
        else:
            create = client.post(
                f"{base}/admin/realms/{realm}/users",
                headers=headers,
                json={
                    "username": username,
                    "enabled": True,
                    "email": email,
                    "emailVerified": True,
                    "firstName": "SecuriPDF",
                    "lastName": "Admin",
                },
            )
            if create.status_code not in (201, 204):
                raise HTTPException(status_code=502, detail=f"Kullanici olusturulamadi: {create.text[:200]}")
            loc = create.headers.get("Location", "")
            user_id = loc.rstrip("/").split("/")[-1] if loc else None
            if not user_id:
                again = client.get(
                    f"{base}/admin/realms/{realm}/users",
                    params={"username": username, "exact": "true"},
                    headers=headers,
                )
                if again.status_code == 200 and again.json():
                    user_id = again.json()[0].get("id")
        if not user_id:
            raise HTTPException(status_code=502, detail="Kullanici ID alinamadi")

        pw = client.put(
            f"{base}/admin/realms/{realm}/users/{user_id}/reset-password",
            headers=headers,
            json={"type": "password", "value": password, "temporary": False},
        )
        if pw.status_code not in (204, 200):
            raise HTTPException(status_code=502, detail=f"Parola ayarlanamadi: {pw.text[:200]}")

        # pdf-admin role
        roles = client.get(f"{base}/admin/realms/{realm}/roles", headers=headers)
        role = None
        if roles.status_code == 200:
            for item in roles.json():
                if item.get("name") == "pdf-admin":
                    role = item
                    break
        if role:
            client.post(
                f"{base}/admin/realms/{realm}/users/{user_id}/role-mappings/realm",
                headers=headers,
                json=[role],
            )

    store = SettingsStore(settings)
    data = store._override()  # noqa: SLF001
    data.setdefault("setup", {})["default_user"] = {
        "created": True,
        "username": username,
        "email": email,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    store._save_override(data)  # noqa: SLF001
    write_audit(settings, actor, "setup.default_user.create", username, {"username": username})
    return {"ok": True, "username": username, "email": email}


def complete_setup(settings: Settings, actor: str = "setup") -> dict[str, Any]:
    status = get_setup_status(settings)
    if not status["storageConfigured"]:
        raise HTTPException(status_code=400, detail="Once depolama yapilandirmasi kaydedilmeli")
    if not status["defaultUserCreated"]:
        raise HTTPException(status_code=400, detail="Once varsayilan kullanici olusturulmali")
    mark_setup_complete(settings, actor)
    reload_info: dict[str, Any] = {"requested": False}
    if updater_configured():
        try:
            from .updater_client import _request

            reload_info = _request("POST", "/auth-gate/reload", {"mode": "secure"})
            reload_info["requested"] = True
        except UpdaterError as exc:
            reload_info = {"requested": True, "ok": False, "error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            reload_info = {"requested": True, "ok": False, "error": str(exc)}
    return {"ok": True, "status": get_setup_status(settings), "authGate": reload_info}
