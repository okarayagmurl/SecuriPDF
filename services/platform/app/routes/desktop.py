from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..audit import write_audit
from ..auth import AuthUser, get_current_user, new_id
from ..config import Settings, get_settings
from ..license import LicenseService
from ..stirling_form import normalize_stirling_form
from ..tools_catalog import get_tool_api_path
from ..user_tool_profiles import assert_user_tool_allowed, effective_tool_ids

router = APIRouter(tags=["desktop"])

# Tools whose server path is a plain Stirling call with no PyMuPDF step and no
# external program (OCR, LibreOffice, qpdf, Ghostscript) behind it.
LOCAL_TOOL_PATHS: dict[str, frozenset[str]] = {
    "merge-pdfs": frozenset({"/api/v1/general/merge-pdfs"}),
    "split-pages": frozenset({
        "/api/v1/general/split-pages",
        "/api/v1/general/split-pdf-by-sections",
        "/api/v1/general/split-by-size-or-count",
    }),
    "rotate-pdf": frozenset({"/api/v1/general/rotate-pdf"}),
    "remove-pages": frozenset({"/api/v1/general/remove-pages"}),
    "extract-pages": frozenset({"/api/v1/general/rearrange-pages"}),
    "rearrange-pages": frozenset({"/api/v1/general/rearrange-pages"}),
    "scale-pages": frozenset({"/api/v1/general/scale-pages"}),
    "crop": frozenset({"/api/v1/general/crop"}),
    "multi-page-layout": frozenset({"/api/v1/general/multi-page-layout"}),
    "pdf-to-single-page": frozenset({"/api/v1/general/pdf-to-single-page"}),
    "overlay-pdf": frozenset({"/api/v1/general/overlay-pdfs"}),
    "add-page-numbers": frozenset({"/api/v1/misc/add-page-numbers"}),
    "add-stamp": frozenset({"/api/v1/misc/add-stamp"}),
    "flatten": frozenset({"/api/v1/misc/flatten"}),
    "add-password": frozenset({"/api/v1/security/add-password"}),
    "remove-password": frozenset({"/api/v1/security/remove-password"}),
    "pdf-to-img": frozenset({"/api/v1/convert/pdf/img"}),
    "img-to-pdf": frozenset({"/api/v1/convert/img/pdf"}),
}

_MAX_INPUTS = 50


class LocalInput(BaseModel):
    field: str = Field(min_length=1, max_length=64)
    sizeBytes: int = Field(ge=0)


class LocalRunRequest(BaseModel):
    toolId: str = Field(min_length=1, max_length=64)
    apiPath: str | None = Field(default=None, max_length=200)
    formData: dict[str, str | list[str]] = Field(default_factory=dict)
    inputs: list[LocalInput] = Field(default_factory=list, max_length=_MAX_INPUTS)


class LocalRunResult(BaseModel):
    ok: bool
    outputBytes: int | None = Field(default=None, ge=0)
    errorCode: str | None = Field(default=None, max_length=64)


def _local_tool_ids(settings: Settings, user_id: str) -> list[str]:
    allowed = effective_tool_ids(settings, user_id)
    return sorted(tool for tool in LOCAL_TOOL_PATHS if tool in allowed)


def _run_path(settings: Settings, run_id: str):
    try:
        safe_id = str(uuid.UUID(run_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Yerel iş bulunamadı") from exc
    return settings.data_path / "desktop-runs" / f"{safe_id}.json"


@router.get("/desktop/local-tools")
def local_tools(
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    return {"tools": _local_tool_ids(settings, user.user_id)}


@router.post("/desktop/local-runs", status_code=201)
def start_local_run(
    body: LocalRunRequest,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    tool_id = body.toolId.strip()
    paths = LOCAL_TOOL_PATHS.get(tool_id)
    if not paths:
        raise HTTPException(status_code=409, detail="Bu araç bilgisayarda çalıştırılamaz")
    LicenseService(settings).assert_tool_allowed(tool_id)
    assert_user_tool_allowed(settings, user.user_id, tool_id)
    api_path = (body.apiPath or "").strip() or get_tool_api_path(tool_id)
    if api_path not in paths:
        raise HTTPException(status_code=409, detail="Bu seçenek bilgisayarda çalıştırılamaz")
    if not body.inputs:
        raise HTTPException(status_code=400, detail="En az bir dosya gerekli")

    run_id = str(uuid.UUID(new_id("lrun")))
    detail = {
        "toolId": tool_id,
        "apiPath": api_path,
        "inputCount": len(body.inputs),
        "inputBytes": sum(item.sizeBytes for item in body.inputs),
    }
    path = _run_path(settings, run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "userId": user.user_id,
                "startedAt": datetime.now(timezone.utc).isoformat(),
                "completedAt": None,
                **detail,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    write_audit(settings, user.user_id, "job.local.started", run_id, detail)
    return {
        "runId": run_id,
        "apiPath": api_path,
        "formData": normalize_stirling_form(tool_id, dict(body.formData)),
    }


@router.post("/desktop/local-runs/{run_id}/result")
def finish_local_run(
    run_id: str,
    body: LocalRunResult,
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    path = _run_path(settings, run_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Yerel iş bulunamadı")
    run = json.loads(path.read_text(encoding="utf-8"))
    if run.get("userId") != user.user_id:
        raise HTTPException(status_code=404, detail="Yerel iş bulunamadı")
    if run.get("completedAt"):
        raise HTTPException(status_code=409, detail="Yerel iş zaten kapatıldı")
    run["completedAt"] = datetime.now(timezone.utc).isoformat()
    run["ok"] = body.ok
    path.write_text(json.dumps(run, ensure_ascii=False), encoding="utf-8")
    detail = {"toolId": run.get("toolId"), "outputBytes": body.outputBytes}
    if not body.ok:
        detail["errorCode"] = body.errorCode or "LOCAL_ENGINE_FAILED"
    write_audit(
        settings,
        user.user_id,
        "job.local.completed" if body.ok else "job.local.failed",
        run_id,
        detail,
    )
    return {"runId": run_id, "ok": body.ok}
