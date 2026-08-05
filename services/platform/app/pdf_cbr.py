"""CBR/RAR arşiv desteği — RAR5 Junrar'da yok; 7z ile CBZ'ye çevir."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path


class CbrConvertError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}


def is_rar5(data: bytes) -> bool:
    return len(data) >= 7 and data[:4] == b"Rar!" and data[4:7] == b"\x1a\x07\x01"


def is_rar(data: bytes) -> bool:
    return len(data) >= 4 and data[:4] == b"Rar!"


def _extract_rar_with_tools(rar_path: Path, out_dir: Path) -> None:
    """7z / unar / unrar ile aç — ilk başarılı araç kazanır."""
    commands: list[list[str]] = []
    if shutil.which("7z"):
        commands.append(["7z", "x", "-y", f"-o{out_dir}", str(rar_path)])
    if shutil.which("7za"):
        commands.append(["7za", "x", "-y", f"-o{out_dir}", str(rar_path)])
    if shutil.which("unar"):
        commands.append(["unar", "-f", "-o", str(out_dir), str(rar_path)])
    if shutil.which("unrar"):
        commands.append(["unrar", "x", "-o+", str(rar_path), str(out_dir) + "/"])

    if not commands:
        raise CbrConvertError("CBR_EXTRACTOR_MISSING")

    last_err = ""
    for cmd in commands:
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=600,
                check=False,
            )
            if proc.returncode == 0 and any(out_dir.rglob("*")):
                return
            last_err = (proc.stderr or proc.stdout or b"").decode("utf-8", errors="replace")[:300]
        except (OSError, subprocess.TimeoutExpired) as exc:
            last_err = str(exc)
            continue
    raise CbrConvertError("CBR_EXTRACT_FAILED")


def rar_bytes_to_cbz(rar_bytes: bytes) -> bytes:
    """RAR/CBR baytlarını CBZ (ZIP+görseller) haline getir."""
    if not is_rar(rar_bytes):
        raise CbrConvertError("CBR_NOT_RAR")

    with tempfile.TemporaryDirectory(prefix="cbr-") as td:
        root = Path(td)
        rar_path = root / "input.cbr"
        out_dir = root / "extracted"
        out_dir.mkdir()
        rar_path.write_bytes(rar_bytes)
        _extract_rar_with_tools(rar_path, out_dir)

        images = sorted(
            p
            for p in out_dir.rglob("*")
            if p.is_file()
            and p.suffix.lower() in _IMAGE_EXTS
            and not p.name.startswith(".")
        )
        if not images:
            raise CbrConvertError("CBR_NO_IMAGES")

        cbz_path = root / "out.cbz"
        with zipfile.ZipFile(cbz_path, "w", compression=zipfile.ZIP_STORED) as zf:
            for idx, img in enumerate(images, start=1):
                arc = f"{idx:04d}{img.suffix.lower()}"
                zf.write(img, arcname=arc)
        return cbz_path.read_bytes()
