from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .auth import AuthUser, get_current_user, require_admin
from .config import get_settings
from .database import init_db
from .maintenance import purge_soft_deleted
from .routes import admin, app_routes, jobs, license, orchestration, pdf_proxy, vault
from .job_queue import start_job_worker, stop_job_worker
from .retention_worker import start_retention_worker, stop_retention_worker
from .vault_retention import purge_expired_documents


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.data_path.mkdir(parents=True, exist_ok=True)
    settings.audit_log_path.parent.mkdir(parents=True, exist_ok=True)
    session_factory = init_db(settings)

    vault_cfg = {}
    vault_path = Path("/config/vault.yml")
    if vault_path.exists():
        with vault_path.open(encoding="utf-8") as handle:
            vault_cfg = yaml.safe_load(handle) or {}
    soft_days = int(vault_cfg.get("retention", {}).get("soft_delete_days", 30))
    db = session_factory()
    try:
        removed = purge_soft_deleted(db, settings, soft_days)
        if removed:
            print(f"[maintenance] {removed} soft-deleted kayit temizlendi")
    finally:
        db.close()

    start_job_worker(settings, session_factory)
    start_retention_worker(settings, session_factory)
    db = session_factory()
    try:
        moved = purge_expired_documents(db, settings)
        if moved:
            print(f"[retention] baslangic: {moved} belge arsive tasindi")
    finally:
        db.close()

    yield

    stop_retention_worker()
    stop_job_worker()


app = FastAPI(title="SecuriPDF Platform", version="1.0.0", lifespan=lifespan)

app.include_router(vault.router, prefix="/api/vault/v1")
app.include_router(admin.router, prefix="/api/vault/v1")
app.include_router(orchestration.router, prefix="/api")
app.include_router(license.router, prefix="/api")
app.include_router(app_routes.router, prefix="/api/app/v1")
app.include_router(jobs.router, prefix="/api/app/v1")
app.include_router(pdf_proxy.router, prefix="/api/pdf/v1")


@app.get("/health")
def health():
    return {"status": "ok", "service": "securipdf-platform"}


static_admin = Path(__file__).parent / "static" / "admin"
static_app = Path(__file__).parent / "static" / "app"
if static_admin.exists():
    app.mount("/admin/static", StaticFiles(directory=static_admin), name="admin-static")
if static_app.exists():
    app.mount("/app/static", StaticFiles(directory=static_app), name="app-static")


@app.get("/admin")
@app.get("/admin/")
def admin_index(user: AuthUser = Depends(get_current_user)):
    require_admin(user)
    index = static_admin / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="Admin UI not found")
    return FileResponse(index)


@app.get("/")
@app.get("/app")
@app.get("/app/")
def app_index(user: AuthUser = Depends(get_current_user)):
    index = static_app / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="SecuriPDF UI not found")
    return FileResponse(index)
