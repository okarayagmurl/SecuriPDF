from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..license import LicenseService
from ..config import Settings, get_settings
from ..database import get_db

router = APIRouter(prefix="/license", tags=["license"])


@router.get("/v1/status")
def license_status(settings: Settings = Depends(get_settings)):
    return LicenseService(settings).status()


@router.get("/v1/tools")
def licensed_tools(settings: Settings = Depends(get_settings)):
    svc = LicenseService(settings)
    return {"enabledTools": svc.status().get("enabledTools", []), "valid": svc.status().get("valid", False)}


@router.post("/v1/session/register")
def register_session(sessionId: str, userId: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    LicenseService(settings).register_session(db, userId, sessionId)
    return {"ok": True}


@router.post("/v1/session/end")
def end_session(sessionId: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    LicenseService(settings).end_session(db, sessionId)
    return {"ok": True}
