from __future__ import annotations

from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import fitz


class AttachmentExtractError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _unique_name(name: str, used: set[str]) -> str:
    name = (name or "ek.bin").replace("\\", "/").split("/")[-1].strip() or "ek.bin"
    base, dot, ext = name.rpartition(".")
    candidate = name
    n = 1
    while candidate.lower() in used:
        candidate = f"{base or 'ek'}-{n}{('.' + ext) if dot else ''}"
        n += 1
    used.add(candidate.lower())
    return candidate


def extract_embedded_attachments(pdf_bytes: bytes) -> bytes:
    """Gömülü dosya ekleri, ek açıklamaları ve gömülü görselleri ZIP'e alır."""
    if not pdf_bytes or pdf_bytes[:4] != b"%PDF":
        raise AttachmentExtractError("INPUT_NOT_PDF")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        used: set[str] = set()
        entries: list[tuple[str, bytes]] = []

        count = int(doc.embfile_count())
        for idx in range(count):
            info = doc.embfile_info(idx) or {}
            name = str(info.get("filename") or info.get("name") or f"ek-{idx + 1}.bin")
            data = doc.embfile_get(idx)
            if data is None:
                continue
            entries.append((_unique_name(name, used), data))

        file_annot = getattr(fitz, "PDF_ANNOT_FILE_ATTACHMENT", 17)
        for page in doc:
            for annot in page.annots() or []:
                kind = annot.type[0] if annot.type else -1
                if kind != file_annot:
                    continue
                try:
                    payload = annot.get_file()
                except Exception:
                    payload = None
                if not payload:
                    continue
                info = annot.info or {}
                name = str(info.get("title") or info.get("content") or "ek.bin")
                entries.append((_unique_name(name, used), payload))

        if not entries:
            seen: set[int] = set()
            for page in doc:
                for img in page.get_images(full=True) or []:
                    xref = int(img[0])
                    if xref in seen:
                        continue
                    seen.add(xref)
                    info = doc.extract_image(xref) or {}
                    raw = info.get("image")
                    if not raw:
                        continue
                    ext = str(info.get("ext") or "bin").lower()
                    entries.append((_unique_name(f"gorsel-{len(entries) + 1}.{ext}", used), raw))

        if not entries:
            raise AttachmentExtractError("EXTRACT_EMPTY")

        buf = BytesIO()
        with ZipFile(buf, "w", compression=ZIP_DEFLATED) as zf:
            for name, data in entries:
                zf.writestr(name, data)
        return buf.getvalue()
    finally:
        doc.close()
