from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..auth import AuthUser, decrypt_bytes, get_current_user, new_id
from ..config import Settings, get_settings
from ..database import JobRecord, get_db
from ..document_store import store_document_bytes
from ..job_queue import _job_dir, enqueue_tool_job
from ..job_refs import load_labels

from ..http_util import content_disposition
from ..job_output import output_file_info

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
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "startedAt": row.started_at.isoformat() if row.started_at else None,
        "completedAt": row.completed_at.isoformat() if row.completed_at else None,
    }
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
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    query = db.query(JobRecord).filter(JobRecord.user_id == user.user_id)
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
        pdf_bytes = next((content for field, _, content, _ in files if field == "fileInput"), files[0][2])
        if str(data.get("watermarkType", "text")).lower() != "text":
            apply_watermark_style(data, wm_style, pdf_bytes)

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
    labels = load_labels(settings, user.user_id, [row.output_ref])
    info = output_file_info(data, row.tool_id)
    filename = labels.get(row.output_ref, info["default_name"])
    if not any(filename.lower().endswith(ext) for ext in (".pdf", ".zip", ".html", ".htm")):
        filename = f"{filename}{info['ext']}"
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
    labels = load_labels(settings, user.user_id, [row.output_ref])
    info = output_file_info(data, row.tool_id)
    filename = labels.get(row.output_ref) or info["default_name"]
    meta_path = _job_dir(settings, row.id) / "meta.json"
    reserved_id: str | None = None
    if meta_path.is_file():
        try:
            job_meta = json.loads(meta_path.read_text(encoding="utf-8"))
            reserved_id = job_meta.get("reservedDocumentId")
        except json.JSONDecodeError:
            reserved_id = None
    try:
        doc = store_document_bytes(
            db,
            settings,
            user.user_id,
            data,
            filename,
            scope="documents",
            doc_id=reserved_id,
            mime_type=info["mime"].split(";")[0],
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
