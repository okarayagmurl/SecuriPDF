from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..auth import AuthUser, decrypt_bytes, get_current_user, new_id
from ..config import Settings, get_settings
from ..database import JobRecord, get_db
from ..debug_report import read_job_debug_report, write_job_debug_report
from ..document_store import store_document_bytes
from ..document_names import resolve_document_filename
from ..job_queue import _job_dir, enqueue_tool_job
from ..job_refs import load_labels

from ..http_util import content_disposition
from ..job_output import ensure_filename_ext, output_file_info
from ..watermark_presets import format_watermark_with_document_number

router = APIRouter(tags=["jobs"])


def _parse_refs(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _job_payload(row: JobRecord, settings: Settings, user: AuthUser, include_labels: bool) -> dict:
    refs = _parse_refs(row.input_refs)
    payload = {
        "id": row.id,
        "toolId": row.tool_id,
        "operation": row.operation,
        "status": row.status,
        "progress": row.progress,
        "inputRefs": refs,
        "outputRef": row.output_ref,
        "errorCode": row.error_code,
        "reportId": row.report_id,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "startedAt": row.started_at.isoformat() if row.started_at else None,
        "completedAt": row.completed_at.isoformat() if row.completed_at else None,
    }
    if row.status == "failed" and row.report_id:
        report = read_job_debug_report(settings, row.report_id)
        hint = (report or {}).get("publicHint")
        if isinstance(hint, str) and hint.strip():
            payload["errorDetail"] = hint.strip()[:240]
    if include_labels:
        labels = load_labels(settings, user.user_id, refs + ([row.output_ref] if row.output_ref else []))
        payload["inputLabels"] = {r: labels[r] for r in refs if r in labels}
        if row.output_ref and row.output_ref in labels:
            payload["outputLabel"] = labels[row.output_ref]
    return payload


def _get_user_job(job_id: str, db: Session, user: AuthUser) -> JobRecord:
    row = db.get(JobRecord, job_id)
    if not row or row.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Is bulunamadi")
    return row


@router.get("/jobs")
def list_jobs(
    page: int = 1,
    size: int = 50,
    status: str | None = None,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    query = db.query(JobRecord).filter(JobRecord.user_id == user.user_id)
    if status:
        query = query.filter(JobRecord.status == status)
    total = query.count()
    rows = query.order_by(JobRecord.created_at.desc()).offset((page - 1) * size).limit(size).all()
    return {
        "items": [_job_payload(r, settings, user, include_labels=True) for r in rows],
        "total": total,
        "page": page,
        "size": size,
    }


@router.get("/jobs/{job_id}")
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = _get_user_job(job_id, db, user)
    return _job_payload(row, settings, user, include_labels=True)


@router.get("/jobs/{job_id}/support-report")
def job_support_report(
    job_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = _get_user_job(job_id, db, user)
    if row.status != "failed":
        raise HTTPException(status_code=400, detail="Destek raporu yalnizca basarisiz isler icin")
    report_id = row.report_id
    if report_id:
        stored = read_job_debug_report(settings, report_id)
        if stored:
            return stored
    refs = _parse_refs(row.input_refs)
    return write_job_debug_report(
        settings,
        report_id=report_id or job_id[:8].upper(),
        job_id=row.id,
        user_id=row.user_id,
        tool_id=row.tool_id,
        status=row.status,
        error_code=row.error_code,
        created_at=row.created_at.isoformat() if row.created_at else None,
        completed_at=row.completed_at.isoformat() if row.completed_at else None,
        input_ref_count=len(refs),
    )


@router.post("/jobs", status_code=202)
async def submit_job(
    request: Request,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    form = await request.form()
    tool_id = form.get("tool_id") or form.get("toolId")
    if not tool_id:
        raise HTTPException(status_code=400, detail="tool_id gerekli")
    tool_id = str(tool_id).strip()

    files: list[tuple[str, str, bytes, str]] = []
    data: dict[str, str | list[str]] = {}
    api_path_override: str | None = None
    for key, value in form.multi_items():
        if key in (
            "tool_id",
            "toolId",
            "outputDownload",
            "outputSaveDocuments",
            "compressSettings",
            "convertSettings",
            "ocrSettings",
            "watermarkSettings",
            "stampSettings",
            "compareSettings",
            "redactSettings",
            "passwordSettings",
            "includeDocumentNumber",
            "watermarkStyle",
            "redactPatternIds",
            "customRedactRegex",
            "redactSelection",
        ):
            continue
        if key == "_apiPath":
            api_path_override = str(value).strip() or None
            continue
        if hasattr(value, "read"):
            content = await value.read()
            files.append((key, value.filename or "", content, value.content_type or "application/octet-stream"))
        else:
            val = str(value)
            if key in data:
                existing = data[key]
                if isinstance(existing, list):
                    existing.append(val)
                else:
                    data[key] = [existing, val]
            else:
                data[key] = val

    if not files and tool_id != "url-to-pdf":
        raise HTTPException(status_code=400, detail="En az bir dosya gerekli")

    if tool_id == "url-to-pdf":
        url = str(data.get("urlInput") or "").strip()
        if not url:
            raise HTTPException(status_code=400, detail="URL gerekli")
        if not url.lower().startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="URL http:// veya https:// ile başlamalıdır")

    if tool_id == "add-image":
        fields = {field for field, _, _, _ in files}
        if "fileInput" not in fields or "imageFile" not in fields:
            raise HTTPException(status_code=400, detail="PDF ve görsel dosyası gerekli")

    if tool_id == "add-attachments":
        fields = {field for field, _, _, _ in files}
        if "fileInput" not in fields or "attachments" not in fields:
            raise HTTPException(status_code=400, detail="PDF ve en az bir ek dosyası gerekli")

    if tool_id == "edit-table-of-contents":
        bm = str(data.get("bookmarkData") or "").strip()
        if not bm:
            raise HTTPException(status_code=400, detail="bookmarkData JSON gerekli")
        try:
            parsed = json.loads(bm)
            if not isinstance(parsed, list):
                raise ValueError("not list")
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="bookmarkData geçerli bir JSON dizisi olmalıdır") from exc

    if tool_id == "merge-pdfs":
        merge_count = sum(1 for field, _, _, _ in files if field == "fileInput")
        if merge_count < 2:
            raise HTTPException(status_code=400, detail="Birlestirmek icin en az 2 PDF gerekli")

    if tool_id == "compare":
        fields = {field for field, _, _, _ in files}
        if "fileInput1" not in fields or "fileInput2" not in fields:
            raise HTTPException(status_code=400, detail="İki PDF dosyası gerekli (Belge 1 ve Belge 2)")

    if tool_id == "auto-redact":
        from ..redaction_presets import expand_redaction_patterns

        selection_raw = form.get("redactSelection")
        has_selection = False
        if selection_raw:
            try:
                selection = json.loads(str(selection_raw))
                areas = selection.get("areas") if isinstance(selection, dict) else None
                has_selection = isinstance(areas, list) and len(areas) > 0
            except json.JSONDecodeError:
                has_selection = False

        ids_raw = form.get("redactPatternIds") or "[]"
        try:
            pattern_ids = json.loads(str(ids_raw))
            if not isinstance(pattern_ids, list):
                pattern_ids = []
        except json.JSONDecodeError:
            pattern_ids = []
        custom_regex = str(form.get("customRedactRegex") or "").strip()

        if has_selection:
            data["redactSelection"] = str(selection_raw)
            data["redactPatternIds"] = json.dumps(pattern_ids, ensure_ascii=False)
            data["customRedactRegex"] = custom_regex
        else:
            try:
                regexes = expand_redaction_patterns(pattern_ids, custom_regex)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            if not regexes:
                raise HTTPException(
                    status_code=400,
                    detail="En az bir hazır desen seçin, özel regex girin veya karartma alanı işaretleyin",
                )
            data["listOfText"] = regexes
            data["redactPatternIds"] = json.dumps(pattern_ids, ensure_ascii=False)
            data["customRedactRegex"] = custom_regex
            if "wholeWordSearch" not in data:
                data["wholeWordSearch"] = "false"

    extra_meta: dict = {}
    if tool_id == "add-watermark":
        wm_style = str(form.get("watermarkStyle") or "tiled")
        extra_meta["watermarkStyle"] = wm_style
        wm_type = str(data.get("watermarkType", "text")).lower()
        if wm_type == "text":
            include_doc = form.get("includeDocumentNumber")
            if include_doc and str(include_doc).lower() in ("true", "on", "1"):
                reserved = new_id("doc")
                extra_meta["reservedDocumentId"] = reserved
                base = str(data.get("watermarkText", "")).strip()
                data["watermarkText"] = format_watermark_with_document_number(base, reserved)
            elif not str(data.get("watermarkText", "")).strip():
                raise HTTPException(
                    status_code=400,
                    detail="Filigran metni veya belge numarası gerekli",
                )
        elif wm_type == "image":
            if not any(field == "watermarkImage" for field, _, _, _ in files):
                raise HTTPException(status_code=400, detail="Filigran görseli gerekli")

    row = enqueue_tool_job(
        settings, db, user.user_id, tool_id, files, data, api_path=api_path_override, extra_meta=extra_meta or None
    )
    return _job_payload(row, settings, user, include_labels=True)


@router.get("/jobs/{job_id}/result")
def download_job_result(
    job_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = _get_user_job(job_id, db, user)
    if row.status != "completed" or not row.output_ref:
        raise HTTPException(status_code=409, detail="Is henuz tamamlanmadi")
    out_path = _job_dir(settings, row.id) / f"{row.output_ref}.out"
    if not out_path.is_file():
        raise HTTPException(status_code=404, detail="Cikti bulunamadi")
    data = decrypt_bytes(settings, out_path.read_bytes())
    if not data:
        raise HTTPException(status_code=409, detail="Cikti dosyasi bos")
    labels = load_labels(settings, user.user_id, [row.output_ref])
    meta_path = _job_dir(settings, row.id) / "meta.json"
    form_data: dict = {}
    if meta_path.is_file():
        try:
            form_data = json.loads(meta_path.read_text(encoding="utf-8")).get("formData") or {}
        except json.JSONDecodeError:
            form_data = {}
    info = output_file_info(data, row.tool_id, form_data)
    filename = labels.get(row.output_ref) or info["default_name"]
    filename = ensure_filename_ext(filename, info["ext"])
    return Response(
        content=data,
        media_type=info["mime"],
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )


@router.post("/jobs/{job_id}/import-documents")
def import_job_to_documents(
    job_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = _get_user_job(job_id, db, user)
    if row.status != "completed" or not row.output_ref:
        raise HTTPException(status_code=409, detail="Is henuz tamamlanmadi")
    out_path = _job_dir(settings, row.id) / f"{row.output_ref}.out"
    if not out_path.is_file():
        raise HTTPException(status_code=404, detail="Cikti bulunamadi")
    data = decrypt_bytes(settings, out_path.read_bytes())
    if not data:
        raise HTTPException(status_code=409, detail="Cikti dosyasi bos")
    labels = load_labels(settings, user.user_id, [row.output_ref])
    meta_path = _job_dir(settings, row.id) / "meta.json"
    form_data: dict = {}
    reserved_id: str | None = None
    if meta_path.is_file():
        try:
            job_meta = json.loads(meta_path.read_text(encoding="utf-8"))
            form_data = job_meta.get("formData") or {}
            reserved_id = job_meta.get("reservedDocumentId")
        except json.JSONDecodeError:
            form_data = {}
            reserved_id = None
    info = output_file_info(data, row.tool_id, form_data)
    filename, mime = resolve_document_filename(
        labels.get(row.output_ref) or info["default_name"],
        info["mime"].split(";")[0],
        data,
    )
    try:
        doc = store_document_bytes(
            db,
            settings,
            user.user_id,
            data,
            filename,
            scope="documents",
            doc_id=reserved_id,
            mime_type=mime,
            audit_action="document.job_import",
            audit_detail={"jobId": row.id, "toolId": row.tool_id},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "documentId": doc.id,
        "documentGuid": doc.id,
        "name": doc.name,
        "sizeBytes": doc.size_bytes,
    }
