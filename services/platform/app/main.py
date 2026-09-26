from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .auth import AuthUser, get_current_user, require_admin
from .config import get_settings
from .database import init_db
from .maintenance import purge_soft_deleted
from .routes import admin, app_routes, jobs, license, orchestration, pdf_proxy, setup, vault
from .job_queue import start_job_worker, stop_job_worker
from .retention_worker import start_retention_worker, stop_retention_worker
from .setup_wizard import ensure_legacy_setup_complete, is_setup_complete
from .vault_retention import purge_expired_documents


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.data_path.mkdir(parents=True, exist_ok=True)
    settings.audit_log_path.parent.mkdir(parents=True, exist_ok=True)
    # init_db oncesi: taze metadata.db legacy sayilmasin
    ensure_legacy_setup_complete(settings)
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

app.include_router(setup.router)
app.include_router(vault.router, prefix="/api/vault/v1")
app.include_router(admin.router, prefix="/api/vault/v1")
app.include_router(orchestration.router, prefix="/api")
app.include_router(license.router, prefix="/api")
app.include_router(app_routes.router, prefix="/api/app/v1")
app.include_router(jobs.router, prefix="/api/app/v1")
app.include_router(pdf_proxy.router, prefix="/api/pdf/v1")


_SETUP_ALLOW_PREFIXES = (
    "/setup",
    "/api/setup/",
    "/health",
    "/api/license/v1/status",
)


@app.middleware("http")
async def first_run_setup_gate(request: Request, call_next):
    path = request.url.path or "/"
    if any(path == p.rstrip("/") or path.startswith(p) for p in _SETUP_ALLOW_PREFIXES):
        return await call_next(request)
    if path.startswith("/admin/static") or path.startswith("/app/static") or path.startswith("/setup/static"):
        return await call_next(request)
    try:
        settings = get_settings()
        if not is_setup_complete(settings):
            if path.startswith("/api/"):
                return JSONResponse(
                    {"detail": "Kurulum tamamlanmadi", "setupRequired": True},
                    status_code=503,
                )
            return RedirectResponse(url="/setup", status_code=302)
    except Exception:  # noqa: BLE001
        pass
    return await call_next(request)


@app.get("/health")
def health():
    return {"status": "ok", "service": "securipdf-platform"}


static_admin = Path(__file__).parent / "static" / "admin"
static_app = Path(__file__).parent / "static" / "app"
static_setup = Path(__file__).parent / "static" / "setup"
if static_admin.exists():
    app.mount("/admin/static", StaticFiles(directory=static_admin), name="admin-static")
if static_app.exists():
    app.mount("/app/static", StaticFiles(directory=static_app), name="app-static")
if static_setup.exists():
    app.mount("/setup/static", StaticFiles(directory=static_setup), name="setup-static")


@app.get("/setup")
@app.get("/setup/")
def setup_index():
    settings = get_settings()
    if is_setup_complete(settings):
        return RedirectResponse(url="/oauth2/start?rd=/", status_code=302)
    index = static_setup / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="Setup UI not found")
    return FileResponse(index)


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
