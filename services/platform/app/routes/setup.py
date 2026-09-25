from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..config import Settings, get_settings
from ..setup_wizard import (
    complete_setup,
    create_default_user,
    get_setup_status,
    is_setup_complete,
    save_storage_config,
)

router = APIRouter(tags=["setup"])


def _require_incomplete(settings: Settings) -> None:
    if is_setup_complete(settings):
        raise HTTPException(status_code=409, detail="Kurulum zaten tamamlandi")


@router.get("/api/setup/v1/status")
def setup_status(settings: Settings = Depends(get_settings)):
    return get_setup_status(settings)


class StorageBody(BaseModel):
    backend: str
    data_path: str | None = None
    db_path: str | None = None
    endpoint: str | None = None
    bucket: str | None = None
    region: str | None = None
    prefix: str | None = None
    access_key: str | None = None
    secret_key: str | None = None
    path: str | None = None
    username: str | None = None
    password: str | None = None


@router.post("/api/setup/v1/storage")
def setup_storage(body: StorageBody, settings: Settings = Depends(get_settings)):
    _require_incomplete(settings)
    return save_storage_config(settings, body.model_dump(exclude_none=True), actor="setup")


class DefaultUserBody(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    email: str | None = None


@router.post("/api/setup/v1/default-user")
def setup_default_user(body: DefaultUserBody, settings: Settings = Depends(get_settings)):
    _require_incomplete(settings)
    return create_default_user(
        settings,
        username=body.username,
        password=body.password,
        email=body.email,
        actor="setup",
    )


@router.post("/api/setup/v1/complete")
def setup_finish(settings: Settings = Depends(get_settings)):
    _require_incomplete(settings)
    return complete_setup(settings, actor="setup")
