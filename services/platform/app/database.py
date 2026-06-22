from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import Settings


class Base(DeclarativeBase):
    pass


class DocumentRecord(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True)
    user_id = Column(String, index=True, nullable=False)
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


_engine = None
_SessionLocal = None


def init_db(settings: Settings) -> sessionmaker[Session]:
    global _engine, _SessionLocal
    settings.data_path.mkdir(parents=True, exist_ok=True)
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    _engine = create_engine(f"sqlite:///{settings.db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(_engine)
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
