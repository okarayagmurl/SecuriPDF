from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from sqlalchemy.orm import Session

from .audit import write_audit
from .auth import decrypt_bytes, encrypt_bytes, new_id
from .config import Settings
from .database import DocumentRecord, JobRecord
from .debug_report import new_report_id, write_job_debug_report
from .compare_renderer import CompareError, compare_pdfs_to_html
from .redaction_renderer import RedactionError, apply_pdf_redactions_from_form
from .job_refs import load_labels, new_ref_id, save_label
from .job_output import ensure_filename_ext, output_file_info
from .license import LicenseService
from .pdf_autosplit import split_pdf_on_blank_pages
from .pdf_cert_sign import (
    CertSignError,
    sign_pdf_from_job,
    supports_platform_cert_sign,
    wants_visible_signature,
)
from .pdf_page_util import extract_single_page, replace_single_page
from .pdf_permissions import PermissionsError, change_permissions
from .pdf_sanitize import sanitize_pdf_bytes
from .pdf_toc import TocError, apply_toc
from .pdf_validate import is_valid_pdf, output_error_code
from .stirling_form import encode_stirling_multipart, normalize_stirling_form
from .mail import send_document_email
from .tools_catalog import get_tool_api_path
from .url_to_pdf import UrlFetchError, url_to_html_pdf_request
from .watermark_renderer import apply_image_watermark, apply_text_watermark

_TIMEOUT = httpx.Timeout(3600.0, connect=60.0)
_worker: JobWorker | None = None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _job_dir(settings: Settings, job_id: str) -> Path:
    path = settings.data_path / "jobs" / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def enqueue_tool_job(
    settings: Settings,
    db: Session,
    user_id: str,
    tool_id: str,
    files: list[tuple[str, str, bytes, str]],
    form_data: dict[str, str | list[str]],
    api_path: str | None = None,
    extra_meta: dict | None = None,
) -> JobRecord:
    LicenseService(settings).assert_tool_allowed(tool_id)
    from .user_tool_profiles import assert_user_tool_allowed

    assert_user_tool_allowed(settings, user_id, tool_id)
    job_id = new_id("job")
    input_refs: list[str] = []
    job_path = _job_dir(settings, job_id)
    inputs_dir = job_path / "inputs"
    inputs_dir.mkdir(exist_ok=True)

    for field_name, filename, content, content_type in files:
        ref_id = new_ref_id()
        input_refs.append(ref_id)
        (inputs_dir / f"{ref_id}.meta").write_text(
            json.dumps({"field": field_name, "contentType": content_type}, ensure_ascii=False),
            encoding="utf-8",
        )
        (inputs_dir / f"{ref_id}.bin").write_bytes(encrypt_bytes(settings, content))
        if filename:
            save_label(settings, user_id, ref_id, filename)

    meta = {
        "toolId": tool_id,
        "formData": form_data,
        "inputRefs": input_refs,
    }
    if api_path:
        meta["apiPath"] = api_path
    if extra_meta:
        meta.update(extra_meta)
    (job_path / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    row = JobRecord(
        id=job_id,
        user_id=user_id,
        tool_id=tool_id,
        operation=f"pdf.{tool_id}",
        status="queued",
        progress=0,
        input_refs=json.dumps(input_refs),
        output_ref=None,
        error_code=None,
        report_id=new_report_id(),
        created_at=utcnow(),
        started_at=None,
        completed_at=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    write_audit(
        settings,
        user_id,
        "job.queued",
        job_id,
        {
            "toolId": tool_id,
            "inputRefs": input_refs,
            "inputCount": len(input_refs),
            "reportId": row.report_id,
        },
    )
    return row


def enqueue_email_job(
    settings: Settings,
    db: Session,
    user_id: str,
    doc_id: str,
    to_addr: str,
    filename: str,
) -> JobRecord:
    job_id = new_id("job")
    ref_id = new_ref_id()
    job_path = _job_dir(settings, job_id)
    meta = {
        "jobType": "document-email",
        "docId": doc_id,
        "toAddr": to_addr,
        "filename": filename,
        "inputRefs": [ref_id],
    }
    (job_path / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    save_label(settings, user_id, ref_id, filename)

    row = JobRecord(
        id=job_id,
        user_id=user_id,
        tool_id="document-email",
        operation="document.email",
        status="queued",
        progress=0,
        input_refs=json.dumps([ref_id]),
        output_ref=None,
        error_code=None,
        report_id=new_report_id(),
        created_at=utcnow(),
        started_at=None,
        completed_at=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    write_audit(
        settings,
        user_id,
        "job.queued",
        job_id,
        {
            "toolId": "document-email",
            "documentRef": doc_id,
            "channel": "email",
            "reportId": row.report_id,
        },
    )
    return row


def _process_email_job(settings: Settings, db: Session, row: JobRecord, meta: dict) -> None:
    from .auth import decrypt_bytes

    doc_id = meta.get("docId")
    to_addr = meta.get("toAddr")
    if not doc_id or not to_addr:
        _finalize_failed_row(settings, row, "EMAIL_META_MISSING")
        db.commit()
        return

    doc_row = db.get(DocumentRecord, doc_id)
    if not doc_row or doc_row.deleted_at or doc_row.user_id != row.user_id:
        _finalize_failed_row(settings, row, "DOCUMENT_NOT_FOUND")
        db.commit()
        return

    row.status = "running"
    row.started_at = utcnow()
    row.progress = 15
    db.commit()

    try:
        payload = Path(doc_row.storage_path).read_bytes()
        data = decrypt_bytes(settings, payload)
    except OSError:
        _finalize_failed_row(settings, row, "STORAGE_READ_FAILED")
        db.commit()
        return

    row.progress = 45
    db.commit()

    try:
        send_document_email(
            settings,
            to_addr=to_addr,
            filename=doc_row.name,
            pdf_bytes=data,
            user_id=row.user_id,
        )
    except Exception:
        _finalize_failed_row(settings, row, "EMAIL_SEND_FAILED")
        db.commit()
        return

    row.status = "completed"
    row.progress = 100
    row.completed_at = utcnow()
    db.commit()
    write_audit(
        settings,
        row.user_id,
        "document.email",
        doc_id,
        {"documentRef": doc_id, "channel": "email", "jobId": row.id},
    )
    write_audit(
        settings,
        row.user_id,
        "job.completed",
        row.id,
        {"toolId": "document-email", "documentRef": doc_id},
    )


def _set_progress(db: Session, row: JobRecord, progress: int, status: str | None = None) -> None:
    row.progress = max(0, min(100, progress))
    if status:
        row.status = status
    db.commit()


def _parse_input_refs(row: JobRecord) -> list[str]:
    try:
        data = json.loads(row.input_refs or "[]")
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _ensure_report_id(row: JobRecord) -> str:
    if not row.report_id:
        row.report_id = new_report_id()
    return row.report_id


def _finalize_failed_row(
    settings: Settings,
    row: JobRecord,
    error_code: str,
    *,
    stirling_status: int | None = None,
    stirling_body: bytes | None = None,
    form_data: dict | None = None,
) -> str:
    report_id = _ensure_report_id(row)
    row.status = "failed"
    row.error_code = error_code
    row.progress = 0
    row.completed_at = utcnow()
    refs = _parse_input_refs(row)
    write_job_debug_report(
        settings,
        report_id=report_id,
        job_id=row.id,
        user_id=row.user_id,
        tool_id=row.tool_id,
        status="failed",
        error_code=error_code,
        created_at=row.created_at.isoformat() if row.created_at else None,
        completed_at=row.completed_at.isoformat() if row.completed_at else None,
        stirling_status=stirling_status,
        stirling_body=stirling_body,
        form_fields=list(form_data.keys()) if isinstance(form_data, dict) else None,
        form_data=form_data if isinstance(form_data, dict) else None,
        input_ref_count=len(refs),
    )
    detail: dict = {
        "toolId": row.tool_id,
        "inputRefs": refs,
        "errorCode": error_code,
        "reportId": report_id,
    }
    if row.tool_id == "document-email":
        detail.pop("inputRefs", None)
    write_audit(settings, row.user_id, "job.failed", row.id, detail)
    return report_id


def _fail_job(
    session_factory,
    job_id: str,
    settings: Settings,
    user_id: str,
    tool_id: str,
    input_refs: list[str],
    error_code: str,
    *,
    form_data: dict | None = None,
    stirling_status: int | None = None,
    stirling_body: bytes | None = None,
) -> None:
    db = session_factory()
    try:
        row = db.get(JobRecord, job_id)
        if not row:
            return
        _finalize_failed_row(
            settings,
            row,
            error_code,
            stirling_status=stirling_status,
            stirling_body=stirling_body,
            form_data=form_data,
        )
        db.commit()
    finally:
        db.close()


def _stirling_body_snippet(body: bytes, limit: int = 280) -> str:
    text = body[:800].decode("utf-8", errors="replace").strip()
    if not text:
        return ""
    if text.startswith("<"):
        return ""
    # JSON {"message":"..."} veya düz metin
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            for key in ("message", "error", "detail", "title"):
                val = data.get(key)
                if isinstance(val, str) and val.strip():
                    text = val.strip()
                    break
    except json.JSONDecodeError:
        pass
    text = " ".join(text.split())
    return text[:limit]


def _stirling_error_code(status: int, body: bytes) -> str:
    text = body[:800].decode("utf-8", errors="replace").lower()
    if status == 502 and "bad gateway" in text:
        return "STIRLING_OCR_UNAVAILABLE"
    if any(k in text for k in ("weasyprint", "weasy print", "missing dependency")):
        return "STIRLING_WEASYPRINT_MISSING"
    if status == 400 and any(
        k in text for k in ("not a cbr", "notcbr", "invalid cbr", "no valid images", "encrypted")
    ):
        return "STIRLING_CBR_INVALID"
    if status == 400:
        return "STIRLING_HTTP_400"
    return f"STIRLING_HTTP_{status}"


def _ensure_cbr_filename(
    files: list[tuple[str, tuple[str | None, bytes, str | None]]],
) -> list[tuple[str, tuple[str | None, bytes, str | None]]]:
    """Stirling Junrar yalnızca .cbr/.rar uzantısını kabul eder; ZIP/CBZ'yi reddeder."""
    out: list[tuple[str, tuple[str | None, bytes, str | None]]] = []
    for field, (name, content, ctype) in files:
        if field != "fileInput":
            out.append((field, (name, content, ctype)))
            continue
        raw = (name or "").strip() or "comic.cbr"
        lower = raw.lower()
        if not (lower.endswith(".cbr") or lower.endswith(".rar")):
            stem = raw.rsplit(".", 1)[0] if "." in raw else raw
            raw = f"{stem}.cbr"
        # RAR magic "Rar!" — CBZ (ZIP) veya boş dosya Junrar'da "invalid CBR" olur.
        if content[:4] == b"PK\x03\x04" or content[:2] == b"PK":
            raise ValueError("CBR_NOT_RAR")
        if len(content) >= 4 and content[:4] != b"Rar!":
            # Bazı eski RAR'lar farklı; yine de uzantıyı düzeltip Stirling'e bırak.
            pass
        mime = ctype or "application/vnd.comicbook-rar"
        if "octet-stream" in mime or mime == "application/x-cbr":
            mime = "application/vnd.comicbook-rar"
        out.append((field, (raw, content, mime)))
    return out


def _zip_entry_count(data: bytes) -> int:
    if not data or data[:2] != b"PK":
        return 0
    import zipfile
    from io import BytesIO

    try:
        with zipfile.ZipFile(BytesIO(data)) as zf:
            return sum(1 for info in zf.infolist() if not info.is_dir())
    except zipfile.BadZipFile:
        return 0


def _stirling_cert_sign(
    target: str,
    stirling_form_data: dict[str, str | list[str]],
    files: list[tuple[str, tuple[str | None, bytes, str | None]]],
) -> tuple[bytes | None, int | None, bytes, str | None]:
    multipart = encode_stirling_multipart(stirling_form_data, files)
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(target, files=multipart)
    status = resp.status_code
    body = resp.content or b""
    if status < 400:
        name = _filename_from_disposition(resp.headers.get("content-disposition"))
        return body, status, body, name
    return None, status, body, None


def _filename_from_disposition(header: str | None) -> str | None:
    if not header:
        return None
    import re

    match = re.search(r"filename\*?=(?:UTF-8''|utf-8'')?[\"']?([^\"';]+)", header, re.I)
    if not match:
        return None
    from urllib.parse import unquote

    name = unquote(match.group(1).strip()).strip("\"'")
    return name or None


def _adjust_add_image_coords(
    stirling_form_data: dict[str, str | list[str]],
    files: list[tuple[str, tuple[str | None, bytes, str | None]]],
) -> None:
    """UI x/y tiklama noktasi = gorsel merkezi; Stirling sol-ust kose bekler."""
    import fitz

    x = int(str(stirling_form_data.get("x", "0")) or 0)
    y = int(str(stirling_form_data.get("y", "0")) or 0)
    img_item = next((item for item in files if item[0] == "imageFile"), None)
    pdf_item = next((item for item in files if item[0] == "fileInput"), None)
    if not img_item:
        return
    try:
        img_doc = fitz.open(stream=img_item[1][1], filetype="image")
        iw, ih = float(img_doc[0].rect.width), float(img_doc[0].rect.height)
        img_doc.close()
    except Exception:
        return
    stirling_form_data["x"] = str(max(0, int(round(x - iw / 2.0))))
    # PDF koordinatlari: y asagidan; onizleme yukaridan
    if pdf_item:
        try:
            pdf_doc = fitz.open(stream=pdf_item[1][1], filetype="pdf")
            page_h = float(pdf_doc[0].rect.height)
            pdf_doc.close()
            y_top_left = max(0, int(round(y - ih / 2.0)))
            stirling_form_data["y"] = str(max(0, int(round(page_h - y_top_left - ih))))
            return
        except Exception:
            pass
    stirling_form_data["y"] = str(max(0, int(round(y - ih / 2.0))))


def _process_job(settings: Settings, session_factory, db: Session, row: JobRecord) -> None:
    job_path = _job_dir(settings, row.id)
    meta_path = job_path / "meta.json"
    if not meta_path.is_file():
        _finalize_failed_row(settings, row, "META_MISSING")
        db.commit()
        return

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("jobType") == "document-email":
        _process_email_job(settings, db, row, meta)
        return

    tool_id = meta["toolId"]
    form_data = meta.get("formData") or {}
    input_refs: list[str] = meta.get("inputRefs") or []

    row.status = "running"
    row.started_at = utcnow()
    row.progress = 5
    db.commit()

    api_path = meta.get("apiPath") or get_tool_api_path(tool_id)
    target = f"{settings.stirling_url.rstrip('/')}{api_path}"
    inputs_dir = job_path / "inputs"

    files: list[tuple[str, tuple[str | None, bytes, str | None]]] = []
    field_ref: dict[str, str] = {}
    input_labels = load_labels(settings, row.user_id, input_refs)
    for ref_id in input_refs:
        meta_file = inputs_dir / f"{ref_id}.meta"
        bin_file = inputs_dir / f"{ref_id}.bin"
        if not meta_file.is_file() or not bin_file.is_file():
            _finalize_failed_row(settings, row, "INPUT_MISSING", form_data=form_data)
            db.commit()
            return
        file_meta = json.loads(meta_file.read_text(encoding="utf-8"))
        content = decrypt_bytes(settings, bin_file.read_bytes())
        field = file_meta.get("field", "fileInput")
        ctype = file_meta.get("contentType") or "application/octet-stream"
        orig_name = input_labels.get(ref_id) or f"{ref_id}.bin"
        files.append((field, (orig_name, content, ctype)))
        field_ref[str(field)] = ref_id

    if tool_id == "add-image":
        scale = int(str(form_data.get("imageScalePercent", form_data.get("image_scale_percent", "100")) or 100))
        if scale != 100 and 10 <= scale <= 200:
            import fitz

            for idx, item in enumerate(files):
                if item[0] != "imageFile":
                    continue
                field, (name, img_bytes, ctype) = item
                try:
                    doc = fitz.open(stream=img_bytes, filetype="image")
                    matrix = fitz.Matrix(scale / 100.0, scale / 100.0)
                    pix = doc[0].get_pixmap(matrix=matrix)
                    files[idx] = (field, (name, pix.tobytes("png"), "image/png"))
                except Exception:
                    pass
                break

    row.progress = 25
    db.commit()

    row.progress = 40
    db.commit()

    if tool_id == "add-watermark":
        wt = form_data.get("watermarkText")
        if wt and ("\n" in str(wt) or "\r" in str(wt)):
            parts = [p.strip() for p in str(wt).replace("\r", "").split("\n") if p.strip()]
            form_data["watermarkText"] = " · ".join(parts) if parts else str(wt).replace("\n", " ").replace("\r", "")
        wm_type = str(form_data.get("watermarkType", "text")).lower()
        if wm_type == "image":
            # Stil spacer alanları yalnızca Stirling'e giderdi; PyMuPDF yolu stil id kullanır.
            pass

    job_id = row.id
    user_id = row.user_id
    db.close()

    add_image_original: bytes | None = None
    add_image_page: int | None = None
    if tool_id == "add-image":
        every = str(form_data.get("everyPage", form_data.get("every_page", "false"))).lower() in (
            "true",
            "1",
            "on",
        )
        page_num = int(str(form_data.get("pageNumber", form_data.get("page_number", "1")) or 1))
        if not every and page_num > 1:
            add_image_original = next((item[1][1] for item in files if item[0] == "fileInput"), b"")
            add_image_page = page_num
            try:
                single_pdf = extract_single_page(add_image_original, page_num)
            except Exception:
                _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "INPUT_MISSING")
                return
            for idx, item in enumerate(files):
                if item[0] == "fileInput":
                    field, (name, _content, ctype) = item
                    files[idx] = (field, (name, single_pdf, ctype))
                    break

    stirling_form_data = normalize_stirling_form(tool_id, form_data)

    if tool_id == "add-image":
        _adjust_add_image_coords(stirling_form_data, files)

    if tool_id == "cbr-to-pdf":
        try:
            files = _ensure_cbr_filename(files)
        except ValueError as exc:
            code = str(exc) if str(exc).startswith("CBR_") else "STIRLING_CBR_INVALID"
            _fail_job(
                session_factory, job_id, settings, user_id, tool_id, input_refs, code, form_data=form_data
            )
            return

    if tool_id == "url-to-pdf":
        page_url = str(stirling_form_data.get("urlInput") or form_data.get("urlInput") or "").strip()
        if not page_url:
            _fail_job(
                session_factory, job_id, settings, user_id, tool_id, input_refs,
                "URL_MISSING", form_data=form_data,
            )
            return
        try:
            html_path, html_files, html_form = url_to_html_pdf_request(
                page_url,
                zoom=str(form_data.get("zoom") or "1"),
            )
            target = f"{settings.stirling_url.rstrip('/')}{html_path}"
            files = html_files
            stirling_form_data = html_form
        except UrlFetchError:
            _fail_job(
                session_factory, job_id, settings, user_id, tool_id, input_refs,
                "URL_FETCH_FAILED", form_data=form_data,
            )
            return

    if tool_id == "cert-sign":
        cert_type = str(stirling_form_data.get("certType") or "PKCS12").upper()
        keep = {"fileInput"}
        if cert_type in ("PKCS12", "PFX"):
            keep |= {"p12File"}
            stirling_form_data["certType"] = "PKCS12"
        elif cert_type == "PEM":
            keep |= {"privateKeyFile", "certFile"}
        elif cert_type == "JKS":
            keep |= {"jksFile"}
        files = [item for item in files if item[0] in keep and item[1][1]]
        for key in ("showSignature", "showLogo"):
            if key not in stirling_form_data:
                stirling_form_data[key] = "false"
        if "pageNumber" not in stirling_form_data:
            stirling_form_data["pageNumber"] = "1"
        stirling_form_data["password"] = str(
            stirling_form_data.get("password") if stirling_form_data.get("password") is not None else ""
        )
        for key in ("reason", "location", "name"):
            if key not in stirling_form_data:
                stirling_form_data[key] = ""

    result_content: bytes | None = None
    stirling_status: int | None = None
    stirling_body: bytes = b""
    stirling_output_name: str | None = None

    if tool_id == "add-watermark":
        try:
            pdf_bytes = next((item[1][1] for item in files if item[0] == "fileInput"), b"")
            if not pdf_bytes and files:
                pdf_bytes = files[0][1][1]
            if not pdf_bytes:
                _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "INPUT_MISSING")
                return
            opacity_raw = str(form_data.get("opacity", "0.5")).strip().replace(",", ".")
            opacity = float(opacity_raw) if opacity_raw else 0.5
            if opacity > 1.0:
                opacity = opacity / 100.0
            opacity = max(0.05, min(opacity, 1.0))
            style_id = str(meta.get("watermarkStyle") or "tiled")
            wm_type = str(form_data.get("watermarkType", "text")).lower()
            if wm_type == "image":
                img_item = next((item for item in files if item[0] == "watermarkImage"), None)
                if not img_item or not img_item[1][1]:
                    _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "INPUT_MISSING")
                    return
                result_content = apply_image_watermark(
                    pdf_bytes,
                    img_item[1][1],
                    style_id=style_id,
                    opacity=opacity,
                    image_name=img_item[1][0],
                )
            else:
                color = str(form_data.get("customColor", "#d3d3d3"))
                font_raw = form_data.get("fontSize")
                font_size = float(str(font_raw).replace(",", ".")) if font_raw not in (None, "") else None
                wm_text = str(form_data.get("watermarkText", "")).strip() or " "
                result_content = apply_text_watermark(
                    pdf_bytes,
                    text=wm_text,
                    style_id=style_id,
                    font_size=font_size,
                    opacity=opacity,
                    color_hex=color,
                )
        except Exception as exc:
            print(f"[job-worker] watermark render failed: {type(exc).__name__}: {exc}")
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "WATERMARK_RENDER_FAILED")
            return
    elif tool_id == "sanitize-pdf":
        try:
            pdf_bytes = next((item[1][1] for item in files if item[0] == "fileInput"), b"")
            if not pdf_bytes and files:
                pdf_bytes = files[0][1][1]
            if not pdf_bytes:
                _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "INPUT_MISSING")
                return
            result_content = sanitize_pdf_bytes(pdf_bytes, form_data)
        except Exception as exc:
            print(f"[job-worker] sanitize failed: {type(exc).__name__}: {exc}")
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "SANITIZE_FAILED")
            return
    elif tool_id == "edit-table-of-contents":
        pdf_bytes = next((item[1][1] for item in files if item[0] == "fileInput"), b"")
        if not pdf_bytes:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "INPUT_MISSING")
            return
        replace = str(form_data.get("replaceExisting", "true")).lower() in {"true", "1", "on", "yes"}
        try:
            result_content = apply_toc(
                pdf_bytes,
                form_data.get("bookmarkData") or "",
                replace_existing=replace,
            )
        except TocError as exc:
            _fail_job(
                session_factory,
                job_id,
                settings,
                user_id,
                tool_id,
                input_refs,
                exc.code,
                form_data=form_data,
            )
            return
        except Exception as exc:
            print(f"[job-worker] toc failed: {type(exc).__name__}: {exc}")
            _fail_job(
                session_factory,
                job_id,
                settings,
                user_id,
                tool_id,
                input_refs,
                "TOC_APPLY_FAILED",
                form_data=form_data,
            )
            return
    elif tool_id == "change-permissions":
        pdf_bytes = next((item[1][1] for item in files if item[0] == "fileInput"), b"")
        if not pdf_bytes:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "INPUT_MISSING")
            return
        try:
            result_content = change_permissions(pdf_bytes, form_data)
        except PermissionsError as exc:
            _fail_job(
                session_factory,
                job_id,
                settings,
                user_id,
                tool_id,
                input_refs,
                exc.code,
                form_data=form_data,
            )
            return
        except Exception as exc:
            print(f"[job-worker] change-permissions failed: {type(exc).__name__}: {exc}")
            _fail_job(
                session_factory,
                job_id,
                settings,
                user_id,
                tool_id,
                input_refs,
                "PERMISSIONS_FAILED",
                form_data=form_data,
            )
            return
    elif tool_id == "auto-split-pdf" or str(api_path).rstrip("/").endswith("auto-split-pdf"):
        # Önce Stirling (QR); başarısız veya tek parça + boş sayfa varsa platform fallback.
        # split-pages → Sayfa ayırıcı modu da aynı yolu kullanır (tool_id hâlâ split-pages).
        try:
            multipart = encode_stirling_multipart(stirling_form_data, files)
            with httpx.Client(timeout=_TIMEOUT) as client:
                resp = client.post(target, files=multipart)
            stirling_status = resp.status_code
            stirling_body = resp.content
            pdf_bytes = next((item[1][1] for item in files if item[0] == "fileInput"), b"")
            duplex = str(stirling_form_data.get("duplexMode", "false")).lower() in ("true", "1", "on")
            used_stirling = False
            if resp.status_code < 400 and resp.content:
                # Stirling QR bulamazsa tek dosyalı ZIP dönebilir — boş sayfa varsa fallback.
                blank_zip = split_pdf_on_blank_pages(pdf_bytes, duplex_mode=duplex) if pdf_bytes else None
                if blank_zip and _zip_entry_count(resp.content) <= 1 and _zip_entry_count(blank_zip) >= 2:
                    result_content = blank_zip
                    stirling_output_name = "otomatik-bolunmus.zip"
                else:
                    result_content = resp.content
                    stirling_output_name = _filename_from_disposition(
                        resp.headers.get("content-disposition")
                    )
                    used_stirling = True
            elif pdf_bytes:
                blank_zip = split_pdf_on_blank_pages(pdf_bytes, duplex_mode=duplex)
                if blank_zip:
                    result_content = blank_zip
                    stirling_output_name = "otomatik-bolunmus.zip"
                    stirling_status = None
                    stirling_body = b""
                else:
                    result_content = None
            if used_stirling:
                pass
        except httpx.RequestError:
            pdf_bytes = next((item[1][1] for item in files if item[0] == "fileInput"), b"")
            duplex = str(stirling_form_data.get("duplexMode", "false")).lower() in ("true", "1", "on")
            blank_zip = split_pdf_on_blank_pages(pdf_bytes, duplex_mode=duplex) if pdf_bytes else None
            if blank_zip:
                result_content = blank_zip
                stirling_output_name = "otomatik-bolunmus.zip"
            else:
                _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "STIRLING_UNREACHABLE")
                return
        except Exception as exc:
            print(f"[job-worker] auto-split failed: {type(exc).__name__}: {exc}")
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "AUTO_SPLIT_FAILED")
            return
    elif tool_id == "compare":
        pdf_a = next((item[1][1] for item in files if item[0] == "fileInput1"), b"")
        pdf_b = next((item[1][1] for item in files if item[0] == "fileInput2"), b"")
        if not pdf_a or not pdf_b:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "COMPARE_INPUT_MISSING")
            return
        ref_ids = [field_ref.get("fileInput1", ""), field_ref.get("fileInput2", "")]
        labels = load_labels(settings, user_id, [r for r in ref_ids if r])
        name_a = labels.get(ref_ids[0], "Belge 1") if ref_ids[0] else "Belge 1"
        name_b = labels.get(ref_ids[1], "Belge 2") if ref_ids[1] else "Belge 2"
        try:
            result_content = compare_pdfs_to_html(
                pdf_a,
                pdf_b,
                name_a=name_a,
                name_b=name_b,
                color_a=str(form_data.get("highlightColor1", "#ffcccc")),
                color_b=str(form_data.get("highlightColor2", "#ccffcc")),
            )
        except CompareError:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "COMPARE_NO_TEXT")
            return
        except Exception:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "COMPARE_FAILED")
            return
    elif tool_id == "auto-redact":
        pdf_bytes = next((item[1][1] for item in files if item[0] == "fileInput"), b"")
        if not pdf_bytes and files:
            pdf_bytes = files[0][1][1]
        ids_raw = form_data.get("redactPatternIds") or "[]"
        try:
            pattern_ids = json.loads(str(ids_raw))
            if not isinstance(pattern_ids, list):
                pattern_ids = []
        except json.JSONDecodeError:
            pattern_ids = []
        custom_regex = str(form_data.get("customRedactRegex") or "")
        try:
            result_content = apply_pdf_redactions_from_form(
                pdf_bytes,
                pattern_ids,
                custom_regex,
                form_data,
            )
        except RedactionError:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "REDACTION_NO_MATCHES")
            return
        except Exception:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "REDACTION_FAILED")
            return
    elif tool_id == "cert-sign":
        pdf_bytes = next((item[1][1] for item in files if item[0] == "fileInput"), b"")
        if not pdf_bytes:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "INPUT_MISSING")
            return
        cert_type = str(stirling_form_data.get("certType") or "PKCS12").upper()
        show_visible = wants_visible_signature(stirling_form_data)
        try:
            if supports_platform_cert_sign(cert_type) and not show_visible:
                result_content = sign_pdf_from_job(pdf_bytes, stirling_form_data, files)
            else:
                result_content, stirling_status, stirling_body, stirling_output_name = _stirling_cert_sign(
                    target, stirling_form_data, files
                )
                out_err = output_error_code(result_content, tool_id)
                if out_err and supports_platform_cert_sign(cert_type):
                    result_content = sign_pdf_from_job(pdf_bytes, stirling_form_data, files)
                    out_err = output_error_code(result_content, tool_id)
                if out_err:
                    _fail_job(
                        session_factory,
                        job_id,
                        settings,
                        user_id,
                        tool_id,
                        input_refs,
                        out_err,
                        form_data=form_data,
                        stirling_status=stirling_status,
                        stirling_body=stirling_body,
                    )
                    return
        except CertSignError as exc:
            _fail_job(
                session_factory,
                job_id,
                settings,
                user_id,
                tool_id,
                input_refs,
                exc.code,
                form_data=form_data,
            )
            return
        except httpx.RequestError:
            if supports_platform_cert_sign(cert_type) and show_visible:
                try:
                    result_content = sign_pdf_from_job(pdf_bytes, stirling_form_data, files)
                except CertSignError as exc:
                    _fail_job(
                        session_factory,
                        job_id,
                        settings,
                        user_id,
                        tool_id,
                        input_refs,
                        exc.code,
                        form_data=form_data,
                    )
                    return
            else:
                _fail_job(
                    session_factory, job_id, settings, user_id, tool_id, input_refs, "STIRLING_UNREACHABLE"
                )
                return
        except Exception:
            _fail_job(
                session_factory,
                job_id,
                settings,
                user_id,
                tool_id,
                input_refs,
                "CERT_SIGN_FAILED",
                form_data=form_data,
            )
            return
    else:
        try:
            multipart = encode_stirling_multipart(stirling_form_data, files)
            with httpx.Client(timeout=_TIMEOUT) as client:
                resp = client.post(target, files=multipart)
            stirling_status = resp.status_code
            stirling_body = resp.content
            if resp.status_code < 400:
                result_content = resp.content
                stirling_output_name = _filename_from_disposition(resp.headers.get("content-disposition"))
                if add_image_original and add_image_page and result_content:
                    try:
                        result_content = replace_single_page(
                            add_image_original, add_image_page, result_content
                        )
                    except Exception:
                        _fail_job(
                            session_factory,
                            job_id,
                            settings,
                            user_id,
                            tool_id,
                            input_refs,
                            "STIRLING_REQUEST_FAILED",
                        )
                        return
        except httpx.RequestError:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "STIRLING_UNREACHABLE")
            return
        except Exception:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "STIRLING_REQUEST_FAILED")
            return

    db = session_factory()
    try:
        row = db.get(JobRecord, job_id)
        if not row:
            return

        row.progress = 75
        db.commit()

        try:
            if result_content is None:
                error_code = _stirling_error_code(stirling_status or 500, stirling_body or b"")
                _finalize_failed_row(
                    settings,
                    row,
                    error_code,
                    stirling_status=stirling_status,
                    stirling_body=stirling_body,
                    form_data=form_data,
                )
                db.commit()
                return

            out_err = output_error_code(result_content, tool_id)
            if out_err:
                _finalize_failed_row(
                    settings,
                    row,
                    out_err,
                    stirling_status=stirling_status,
                    stirling_body=stirling_body,
                    form_data=form_data,
                )
                db.commit()
                return

            output_ref = new_ref_id()
            out_path = job_path / f"{output_ref}.out"
            out_path.write_bytes(encrypt_bytes(settings, result_content))
            out_info = output_file_info(result_content, tool_id, form_data)
            raw_name = stirling_output_name or out_info["default_name"]
            out_name = ensure_filename_ext(raw_name, out_info["ext"])
            save_label(
                settings,
                user_id,
                output_ref,
                out_name,
            )

            row.status = "completed"
            row.progress = 100
            row.output_ref = output_ref
            row.completed_at = utcnow()
            db.commit()
            write_audit(
                settings,
                user_id,
                "job.completed",
                job_id,
                {"toolId": tool_id, "inputRefs": input_refs, "outputRef": output_ref},
            )
        except Exception as exc:
            print(f"[job-worker] finalize failed job={job_id}: {type(exc).__name__}: {exc}")
            try:
                row = db.get(JobRecord, job_id) or row
                _finalize_failed_row(
                    settings,
                    row,
                    "JOB_FINALIZE_FAILED",
                    stirling_status=stirling_status,
                    stirling_body=stirling_body,
                    form_data=form_data,
                )
                db.commit()
            except Exception as inner:
                print(f"[job-worker] finalize fail-mark failed: {inner}")
    finally:
        db.close()


class JobWorker:
    def __init__(self, settings: Settings, session_factory) -> None:
        self._settings = settings
        self._session_factory = session_factory
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, name="securipdf-job-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            if not self._lock.acquire(blocking=False):
                time.sleep(0.3)
                continue
            try:
                self._process_next()
            except Exception as exc:
                print(f"[job-worker] {exc}")
            finally:
                self._lock.release()
            time.sleep(0.4)

    def _process_next(self) -> None:
        db = self._session_factory()
        try:
            row = (
                db.query(JobRecord)
                .filter(JobRecord.status == "queued")
                .order_by(JobRecord.created_at.asc())
                .first()
            )
            if not row:
                return
            _process_job(self._settings, self._session_factory, db, row)
        finally:
            db.close()


def recover_stale_jobs(settings: Settings, session_factory) -> int:
    db = session_factory()
    try:
        rows = db.query(JobRecord).filter(JobRecord.status == "running").all()
        if not rows:
            return 0
        for row in rows:
            _finalize_failed_row(settings, row, "JOB_INTERRUPTED")
        db.commit()
        return len(rows)
    finally:
        db.close()


def start_job_worker(settings: Settings, session_factory) -> JobWorker:
    global _worker
    recovered = recover_stale_jobs(settings, session_factory)
    if recovered:
        print(f"[job-worker] {recovered} yarida kalan is iptal edildi (JOB_INTERRUPTED)")
    _worker = JobWorker(settings, session_factory)
    _worker.start()
    return _worker


def stop_job_worker() -> None:
    global _worker
    if _worker:
        _worker.stop()
        _worker = None


def get_db_session_factory():
    from .database import _SessionLocal

    if _SessionLocal is None:
        raise RuntimeError("Database not initialized")
    return _SessionLocal
