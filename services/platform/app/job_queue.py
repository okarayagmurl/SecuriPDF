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
from .job_output import output_file_info
from .license import LicenseService
from .pdf_page_util import extract_single_page, replace_single_page
from .stirling_form import normalize_stirling_form
from .mail import send_document_email
from .tools_catalog import get_tool_api_path
from .watermark_presets import apply_watermark_style
from .watermark_renderer import apply_text_watermark

_TIMEOUT = httpx.Timeout(3600.0, connect=60.0)
_worker: JobWorker | None = None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _job_dir(settings: Settings, job_id: str) -> Path:
    path = settings.data_path / "jobs" / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _encode_form_data(form_data: dict) -> dict[str, str | list[str]] | None:
    """httpx multipart: files ile birlikte data dict olmali (list of tuples kirar)."""
    if not form_data:
        return None
    encoded: dict[str, str | list[str]] = {}
    for key, value in form_data.items():
        if isinstance(value, list):
            encoded[key] = [str(item) for item in value]
        else:
            encoded[key] = str(value)
    return encoded or None


def _encode_stirling_files(
    files: list[tuple[str, tuple[str | None, bytes, str | None]]],
) -> list[tuple[str, tuple[str, bytes, str]]]:
    """httpx listesi — ayni alan adinda birden fazla dosya (merge-pdfs vb.)."""
    out: list[tuple[str, tuple[str, bytes, str]]] = []
    for field, (filename, content, content_type) in files:
        out.append(
            (
                field,
                (
                    filename or "input.bin",
                    content,
                    content_type or "application/octet-stream",
                ),
            )
        )
    return out


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
) -> None:
    db = session_factory()
    try:
        row = db.get(JobRecord, job_id)
        if not row:
            return
        _finalize_failed_row(settings, row, error_code)
        db.commit()
    finally:
        db.close()


def _stirling_error_code(status: int, body: bytes) -> str:
    if status != 502:
        return f"STIRLING_HTTP_{status}"
    text = body[:500].decode("utf-8", errors="replace").lower()
    if "bad gateway" in text:
        return "STIRLING_OCR_UNAVAILABLE"
    return f"STIRLING_HTTP_{status}"


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
        if wm_type != "text":
            pdf_bytes = files[0][1][1] if files else b""
            apply_watermark_style(form_data, str(meta.get("watermarkStyle") or "tiled"), pdf_bytes)

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

    if tool_id == "url-to-pdf":
        files = []

    result_content: bytes | None = None
    stirling_status: int | None = None
    stirling_body: bytes = b""
    stirling_output_name: str | None = None

    if tool_id == "add-watermark" and str(form_data.get("watermarkType", "text")).lower() == "text":
        try:
            pdf_bytes = files[0][1][1] if files else b""
            opacity = float(str(form_data.get("opacity", "0.5")))
            color = str(form_data.get("customColor", "#d3d3d3"))
            font_raw = form_data.get("fontSize")
            font_size = float(str(font_raw)) if font_raw not in (None, "") else None
            result_content = apply_text_watermark(
                pdf_bytes,
                text=str(form_data.get("watermarkText", "")),
                style_id=str(meta.get("watermarkStyle") or "tiled"),
                font_size=font_size,
                opacity=opacity,
                color_hex=color,
            )
        except Exception:
            _fail_job(session_factory, job_id, settings, user_id, tool_id, input_refs, "WATERMARK_RENDER_FAILED")
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
    else:
        try:
            with httpx.Client(timeout=_TIMEOUT) as client:
                resp = client.post(
                    target,
                    files=_encode_stirling_files(files),
                    data=_encode_form_data(stirling_form_data),
                )
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

        output_ref = new_ref_id()
        out_path = job_path / f"{output_ref}.out"
        out_path.write_bytes(encrypt_bytes(settings, result_content))
        out_info = output_file_info(result_content, tool_id, form_data)
        out_name = stirling_output_name or out_info["default_name"]
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
