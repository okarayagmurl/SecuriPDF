"""PDF → vektör (EPS/PS) — Ghostscript varsa platform yedek."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


class VectorError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


_DEVICE = {
    "eps": "eps2write",
    "ps": "ps2write",
}


def pdf_to_vector_gs(pdf_bytes: bytes, output_format: str = "eps") -> bytes:
    fmt = (output_format or "eps").strip().lower()
    if fmt not in _DEVICE:
        raise VectorError("VECTOR_FORMAT_UNSUPPORTED")
    if not pdf_bytes or pdf_bytes[:4] != b"%PDF":
        raise VectorError("INPUT_NOT_PDF")
    gs = shutil.which("gs") or shutil.which("gswin64c") or shutil.which("gswin32c")
    if not gs:
        raise VectorError("VECTOR_GS_MISSING")

    with tempfile.TemporaryDirectory(prefix="vec-") as td:
        root = Path(td)
        inp = root / "in.pdf"
        out = root / f"out.{fmt}"
        inp.write_bytes(pdf_bytes)
        cmd = [
            gs,
            "-dSAFER",
            "-dBATCH",
            "-dNOPAUSE",
            "-dQUIET",
            f"-sDEVICE={_DEVICE[fmt]}",
            f"-sOutputFile={out}",
            str(inp),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=600, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise VectorError("VECTOR_GS_FAILED") from exc
        if proc.returncode != 0 or not out.is_file() or out.stat().st_size < 32:
            raise VectorError("VECTOR_GS_FAILED")
        data = out.read_bytes()
        if data[:4] == b"%PDF" or data[:1] in (b"{", b"<"):
            raise VectorError("VECTOR_OUTPUT_MISMATCH")
        return data
