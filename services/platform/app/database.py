from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, create_engine, text
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import Settings


class Base(DeclarativeBase):
    pass


class FolderRecord(Base):
    __tablename__ = "folders"

    id = Column(String, primary_key=True)
    user_id = Column(String, index=True, nullable=False)
    scope = Column(String, index=True, nullable=False, default="documents")
    parent_id = Column(String, index=True, nullable=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False)


class DocumentRecord(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True)
    user_id = Column(String, index=True, nullable=False)
    folder_id = Column(String, index=True, nullable=True)
    storage_scope = Column(String, index=True, nullable=False, default="documents")
    pinned = Column(Integer, nullable=False, default=0)
    active_since = Column(DateTime, nullable=True)
    name = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)
    mime_type = Column(String, nullable=False, default="application/pdf")
    storage_path = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False)
    modified_at = Column(DateTime, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class SignatureRecord(Base):
    __tablename__ = "signatures"

    id = Column(String, primary_key=True)
    user_id = Column(String, index=True, nullable=False)
    label = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=False)
    mime_type = Column(String, nullable=False)
    storage_path = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class CertificateRecord(Base):
    __tablename__ = "certificates"

    id = Column(String, primary_key=True)
    user_id = Column(String, index=True, nullable=False)
    label = Column(String, nullable=True)
    subject = Column(String, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    size_bytes = Column(Integer, nullable=False)
    storage_path = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class UserQuotaRecord(Base):
    __tablename__ = "user_quotas"

    user_id = Column(String, primary_key=True)
    max_bytes = Column(Integer, nullable=False)
    used_bytes = Column(Integer, nullable=False, default=0)


class SessionRecord(Base):
    __tablename__ = "active_sessions"

    session_id = Column(String, primary_key=True)
    user_id = Column(String, index=True, nullable=False)
    started_at = Column(DateTime, nullable=False)


class JobRecord(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True)
    user_id = Column(String, index=True, nullable=False)
    tool_id = Column(String, index=True, nullable=False)
    operation = Column(String, nullable=False)
    status = Column(String, index=True, nullable=False, default="queued")
    progress = Column(Integer, nullable=False, default=0)
    input_refs = Column(String, nullable=False, default="[]")
    output_ref = Column(String, nullable=True)
    error_code = Column(String, nullable=True)
    report_id = Column(String, index=True, nullable=True)
    created_at = Column(DateTime, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)


_engine = None
_SessionLocal = None


def _migrate_schema(engine) -> None:
    insp = sa_inspect(engine)
    table_names = insp.get_table_names()
    with engine.begin() as conn:
        if "documents" in table_names:
            cols = {c["name"] for c in insp.get_columns("documents")}
            if "folder_id" not in cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN folder_id VARCHAR"))
            if "storage_scope" not in cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN storage_scope VARCHAR DEFAULT 'documents'"))
            if "pinned" not in cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN pinned INTEGER DEFAULT 0"))
            if "active_since" not in cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN active_since DATETIME"))
                conn.execute(text("UPDATE documents SET active_since = created_at WHERE active_since IS NULL"))
        if "folders" in table_names:
            conn.execute(text("UPDATE folders SET parent_id = NULL WHERE parent_id = ''"))
        if "jobs" in table_names:
            job_cols = {c["name"] for c in insp.get_columns("jobs")}
            if "report_id" not in job_cols:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN report_id VARCHAR"))


def init_db(settings: Settings) -> sessionmaker[Session]:
    global _engine, _SessionLocal
    settings.data_path.mkdir(parents=True, exist_ok=True)
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    _engine = create_engine(f"sqlite:///{settings.db_path}", connect_args={"check_same_thread": False})
    with _engine.connect() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL"))
        conn.commit()
    Base.metadata.create_all(_engine)
    _migrate_schema(_engine)
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
    return _SessionLocal


def get_db() -> Session:
    if _SessionLocal is None:
        raise RuntimeError("Database not initialized")
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
