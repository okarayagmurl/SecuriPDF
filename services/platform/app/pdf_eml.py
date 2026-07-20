from __future__ import annotations

import email
import html
import re
from email import policy
from io import BytesIO


class EmlError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _plain_to_html(text: str) -> str:
    escaped = html.escape(text or "")
    return "<pre style='white-space:pre-wrap;font-family:sans-serif;font-size:12px'>" + escaped + "</pre>"


def _msg_to_html(raw: bytes) -> str:
    try:
        msg = email.message_from_bytes(raw, policy=policy.default)
    except Exception as exc:
        raise EmlError("EML_PARSE_FAILED") from exc

    subject = str(msg.get("subject") or "(konu yok)")
    from_addr = str(msg.get("from") or "")
    to_addr = str(msg.get("to") or "")
    date = str(msg.get("date") or "")

    body_html = ""
    body_text = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = (part.get_content_type() or "").lower()
            disp = str(part.get("Content-Disposition") or "").lower()
            if "attachment" in disp:
                continue
            try:
                payload = part.get_content()
            except Exception:
                continue
            if ctype == "text/html" and isinstance(payload, str) and not body_html:
                body_html = payload
            elif ctype == "text/plain" and isinstance(payload, str) and not body_text:
                body_text = payload
    else:
        try:
            payload = msg.get_content()
        except Exception:
            payload = ""
        ctype = (msg.get_content_type() or "").lower()
        if ctype == "text/html" and isinstance(payload, str):
            body_html = payload
        elif isinstance(payload, str):
            body_text = payload

    content = body_html or _plain_to_html(body_text or "(içerik yok)")
    # Basit stil — harici kaynakları kaldır.
    content = re.sub(r"(?is)<script.*?>.*?</script>", "", content)
    header = (
        f"<div style='font-family:sans-serif;font-size:13px;margin-bottom:16px'>"
        f"<div><strong>Konu:</strong> {html.escape(subject)}</div>"
        f"<div><strong>Kimden:</strong> {html.escape(from_addr)}</div>"
        f"<div><strong>Kime:</strong> {html.escape(to_addr)}</div>"
        f"<div><strong>Tarih:</strong> {html.escape(date)}</div>"
        f"<hr/></div>"
    )
    return f"<html><body>{header}{content}</body></html>"


def eml_to_pdf(raw: bytes) -> bytes:
    """EML → PDF (PyMuPDF story). Stirling/WeasyPrint yedek yolu."""
    import fitz

    if not raw or len(raw) < 8:
        raise EmlError("EML_EMPTY")

    html_doc = _msg_to_html(raw)
    # PyMuPDF Story HTML→PDF
    try:
        story = fitz.Story(html_doc)
    except Exception as exc:
        raise EmlError("EML_RENDER_FAILED") from exc

    out = BytesIO()
    writer = fitz.DocumentWriter(out)
    mediabox = fitz.paper_rect("a4")
    where = mediabox + (36, 36, -36, -36)
    more = True
    while more:
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()
    data = out.getvalue()
    if not data or data[:4] != b"%PDF":
        raise EmlError("EML_RENDER_FAILED")
    return data
