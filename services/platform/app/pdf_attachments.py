from __future__ import annotations

from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile


class AttachmentExtractError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def extract_embedded_attachments(pdf_bytes: bytes) -> bytes:
    """PDF gömülü eklerini ZIP olarak çıkar (PyMuPDF)."""
    import fitz

    if not pdf_bytes or pdf_bytes[:4] != b"%PDF":
        raise AttachmentExtractError("INPUT_NOT_PDF")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        count = int(doc.embfile_count())
        if count <= 0:
            raise AttachmentExtractError("EXTRACT_EMPTY")

        buf = BytesIO()
        used_names: set[str] = set()
        with ZipFile(buf, "w", compression=ZIP_DEFLATED) as zf:
            for idx in range(count):
                info = doc.embfile_info(idx) or {}
                name = str(info.get("filename") or info.get("name") or f"ek-{idx + 1}.bin").strip()
                name = name.replace("\\", "/").split("/")[-1] or f"ek-{idx + 1}.bin"
                base, dot, ext = name.rpartition(".")
                candidate = name
                n = 1
                while candidate.lower() in used_names:
                    candidate = f"{base or 'ek'}-{n}{('.' + ext) if dot else ''}"
                    n += 1
                used_names.add(candidate.lower())
                data = doc.embfile_get(idx)
                if data is None:
                    continue
                zf.writestr(candidate, data)
            if not used_names:
                raise AttachmentExtractError("EXTRACT_EMPTY")
        return buf.getvalue()
    finally:
        doc.close()
