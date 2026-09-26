from __future__ import annotations

import base64
from typing import Any

from fastapi import HTTPException

from .config import Settings
from .crypto_util import decrypt_bytes
from .storage_paths import storage_override

UNREACHABLE_SMB = (
    "SMB paylasimina erisilemiyor. Sunucu, paylasim adi, kimlik bilgileri ve ag erisimini kontrol edin."
)


def shared_cfg(settings: Settings) -> dict[str, Any]:
    return dict(storage_override(settings).get("shared") or {})


def _smb_password(settings: Settings) -> str:
    enc = str(shared_cfg(settings).get("password_enc") or "")
    if not enc:
        return ""
    raw = base64.b64decode(enc.encode("ascii"))
    return decrypt_bytes(settings.master_key, raw).decode("utf-8")


def smb_mode(settings: Settings) -> bool:
    """True = UI SMB (host/share); False = eski container path mount."""
    cfg = shared_cfg(settings)
    if str(cfg.get("host") or "").strip() and str(cfg.get("share") or "").strip():
        return True
    return False


def _register(settings: Settings) -> dict[str, Any]:
    try:
        import smbclient
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="SMB icin smbprotocol yuklu degil") from exc

    cfg = shared_cfg(settings)
    host = str(cfg.get("host") or "").strip()
    username = str(cfg.get("username") or "").strip()
    password = _smb_password(settings)
    domain = str(cfg.get("domain") or "").strip() or None
    if not host:
        raise HTTPException(status_code=400, detail="SMB host zorunlu")
    if not username or not password:
        raise HTTPException(status_code=400, detail="SMB kullanici ve parola zorunlu")

    # username may be DOMAIN\\user
    user = username
    if domain and "\\" not in username and "@" not in username:
        user = f"{domain}\\{username}"

    try:
        smbclient.register_session(host, username=user, password=password)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"SMB oturum acilamadi: {exc}") from exc
    return cfg


def smb_unc(settings: Settings, *parts: str) -> str:
    cfg = shared_cfg(settings)
    host = str(cfg.get("host") or "").strip()
    share = str(cfg.get("share") or "").strip()
    base = str(cfg.get("path") or "").strip().strip("/\\")
    segs = [host, share]
    if base:
        segs.extend(p for p in base.replace("\\", "/").split("/") if p)
    segs.extend(p for p in parts if p)
    # smbclient wants \\host\share\...
    return "\\\\" + "\\".join(segs)


def smb_write(settings: Settings, relative: str, data: bytes) -> None:
    import smbclient

    _register(settings)
    unc = smb_unc(settings, *relative.replace("\\", "/").split("/"))
    parent = "\\".join(unc.split("\\")[:-1])
    try:
        smbclient.makedirs(parent, exist_ok=True)
        with smbclient.open_file(unc, mode="wb") as handle:
            handle.write(data)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"{UNREACHABLE_SMB} (yazma: {exc})") from exc


def smb_read(settings: Settings, relative: str) -> bytes:
    import smbclient

    _register(settings)
    unc = smb_unc(settings, *relative.replace("\\", "/").split("/"))
    try:
        with smbclient.open_file(unc, mode="rb") as handle:
            return handle.read()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"{UNREACHABLE_SMB} (okuma: {exc})") from exc


def smb_delete(settings: Settings, relative: str) -> None:
    import smbclient

    try:
        _register(settings)
        unc = smb_unc(settings, *relative.replace("\\", "/").split("/"))
        smbclient.remove(unc)
    except Exception:  # noqa: BLE001
        pass


def smb_exists(settings: Settings, relative: str) -> bool:
    import smbclient

    try:
        _register(settings)
        unc = smb_unc(settings, *relative.replace("\\", "/").split("/"))
        return bool(smbclient.path.isfile(unc))
    except Exception:  # noqa: BLE001
        return False


def probe_smb(settings: Settings) -> None:
    import smbclient

    _register(settings)
    unc = smb_unc(settings, ".securipdf-write-test")
    parent = "\\".join(unc.split("\\")[:-1])
    try:
        smbclient.makedirs(parent, exist_ok=True)
        with smbclient.open_file(unc, mode="wb") as handle:
            handle.write(b"ok")
        smbclient.remove(unc)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"SMB erisim testi basarisiz: {exc}") from exc
