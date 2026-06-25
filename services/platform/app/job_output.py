from __future__ import annotations


def output_file_info(data: bytes, tool_id: str) -> dict[str, str]:
    """Stirling ciktisinin dosya adi, uzantisi ve MIME turunu belirler."""
    if tool_id == "compare":
        return {
            "default_name": "karsilastirma-raporu.html",
            "ext": ".html",
            "mime": "text/html; charset=utf-8",
        }
    if tool_id == "get-info-on-pdf":
        return {
            "default_name": "pdf-bilgisi.json",
            "ext": ".json",
            "mime": "application/json; charset=utf-8",
        }
    if tool_id == "validate-signature":
        return {
            "default_name": "imza-dogrulama.json",
            "ext": ".json",
            "mime": "application/json; charset=utf-8",
        }
    if tool_id == "verify-pdf":
        return {
            "default_name": "pdf-dogrulama.json",
            "ext": ".json",
            "mime": "application/json; charset=utf-8",
        }
    if tool_id == "pdf-to-csv":
        return {"default_name": "pdf-tablo.csv", "ext": ".csv", "mime": "text/csv; charset=utf-8"}
    if tool_id == "pdf-to-xlsx":
        return {
            "default_name": "pdf-tablo.xlsx",
            "ext": ".xlsx",
            "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }
    if tool_id == "pdf-to-markdown":
        return {"default_name": "pdf-icerik.md", "ext": ".md", "mime": "text/markdown; charset=utf-8"}
    if tool_id == "pdf-to-xml":
        return {"default_name": "pdf-yapi.xml", "ext": ".xml", "mime": "application/xml; charset=utf-8"}
    if tool_id == "pdf-to-epub":
        return {"default_name": "pdf-kitap.epub", "ext": ".epub", "mime": "application/epub+zip"}
    if tool_id == "pdf-to-cbz":
        return {"default_name": "pdf-sayfalar.cbz", "ext": ".cbz", "mime": "application/vnd.comicbook+zip"}
    if tool_id == "pdf-to-cbr":
        return {"default_name": "pdf-sayfalar.cbr", "ext": ".cbr", "mime": "application/vnd.comicbook-rar"}
    if len(data) >= 4 and data[:4] == b"%PDF":
        return {
            "default_name": f"{tool_id}-sonuc.pdf",
            "ext": ".pdf",
            "mime": "application/pdf",
        }
    if len(data) >= 2 and data[:2] == b"PK":
        zip_name = "bolunmus-belgeler.zip"
        if tool_id == "pdf-to-img":
            zip_name = "pdf-gorseller.zip"
        elif tool_id == "extract-images":
            zip_name = "cikarilan-gorseller.zip"
        elif tool_id in ("extract-attachments", "extract-image-scans", "auto-split-pdf"):
            zip_name = {
                "extract-attachments": "pdf-ekleri.zip",
                "extract-image-scans": "tarama-gorselleri.zip",
                "auto-split-pdf": "otomatik-bolunmus.zip",
            }[tool_id]
        return {
            "default_name": zip_name,
            "ext": ".zip",
            "mime": "application/zip",
        }
    if tool_id in (
        "split-pages",
        "pdf-to-img",
        "extract-images",
        "extract-attachments",
        "extract-image-scans",
        "auto-split-pdf",
    ):
        zip_names = {
            "split-pages": "bolunmus-belgeler.zip",
            "pdf-to-img": "pdf-gorseller.zip",
            "extract-images": "cikarilan-gorseller.zip",
            "extract-attachments": "pdf-ekleri.zip",
            "extract-image-scans": "tarama-gorselleri.zip",
            "auto-split-pdf": "otomatik-bolunmus.zip",
        }
        return {
            "default_name": zip_names.get(tool_id, "cikti.zip"),
            "ext": ".zip",
            "mime": "application/zip",
        }
    if tool_id == "pdf-to-text":
        return {
            "default_name": "pdf-metin.txt",
            "ext": ".txt",
            "mime": "text/plain; charset=utf-8",
        }
    if tool_id == "pdf-to-html":
        return {
            "default_name": "pdf-sayfa.html",
            "ext": ".html",
            "mime": "text/html; charset=utf-8",
        }
    if data[:1] in (b"{", b"["):
        return {
            "default_name": f"{tool_id}-sonuc.json",
            "ext": ".json",
            "mime": "application/json; charset=utf-8",
        }
    return {
        "default_name": f"{tool_id}-sonuc.pdf",
        "ext": ".pdf",
        "mime": "application/pdf",
    }
