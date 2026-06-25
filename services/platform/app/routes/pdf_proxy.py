from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from ..auth import AuthUser, get_current_user
from ..config import Settings, get_settings
from ..database import get_db
from ..job_queue import enqueue_tool_job
from ..license import LicenseService
from sqlalchemy.orm import Session

router = APIRouter(prefix="/tools", tags=["pdf"])

_TIMEOUT_MSG = "PDF islemleri merkezi kuyruk uzerinden yapilir. POST /api/app/v1/jobs kullanin."


@router.post("/{tool_id}")
async def run_pdf_tool(
    tool_id: str,
    request: Request,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
):
    """Eski uç nokta — isleri merkezi kuyruga alir (202)."""
    LicenseService(settings).assert_tool_allowed(tool_id)
    form = await request.form()
    files: list[tuple[str, str, bytes, str]] = []
    data: dict[str, str] = {}
    for key, value in form.multi_items():
        if hasattr(value, "read"):
            content = await value.read()
            files.append((key, value.filename or "", content, value.content_type or "application/octet-stream"))
        else:
            data[key] = str(value)
    if not files:
        raise HTTPException(status_code=400, detail="En az bir dosya gerekli")

    row = enqueue_tool_job(settings, db, user.user_id, tool_id, files, data)
    return JSONResponse(
        status_code=202,
        content={
            "jobId": row.id,
            "status": row.status,
            "progress": row.progress,
            "message": _TIMEOUT_MSG,
            "statusUrl": f"/api/app/v1/jobs/{row.id}",
            "resultUrl": f"/api/app/v1/jobs/{row.id}/result",
        },
    )
