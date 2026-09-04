"""
database.py — SQLAlchemy persistence layer (Task 5).
Default: SQLite file (./procurement.db) so the app works with zero setup.
Set DATABASE_URL env var to switch to PostgreSQL for production.

HOW TO ENABLE:
  1. Set DATABASE_URL=postgresql://user:pass@host:5432/dbname in .env
  2. pip install psycopg2-binary  (for Postgres)
  3. Call init_db() on startup (already wired in main.py via @app.on_event)
"""

import os
from datetime import date

from sqlalchemy import (
    create_engine, Column, String, Float, Integer,
    Boolean, Date, Text, JSON, DateTime,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from datetime import datetime

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./procurement.db")

# SQLite needs check_same_thread=False for FastAPI's thread pool
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, echo=False)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass

# ORM Models

class PurchaseOrderDB(Base):
    __tablename__ = "purchase_orders"

    po_id        = Column(String, primary_key=True, index=True)
    supplier_id  = Column(String, nullable=False)
    items        = Column(JSON, nullable=False)        # list[POLineItem] serialised
    total_cost   = Column(Float, nullable=False)
    reasoning    = Column(Text, nullable=False)
    status       = Column(String, nullable=False)
    generated_by = Column(String, default="llm")
    created_at   = Column(Date, default=date.today)


class RiskAlertDB(Base):
    __tablename__ = "risk_alerts"

    alert_id              = Column(String, primary_key=True, index=True)
    sku_id                = Column(String, nullable=False)
    site_id               = Column(String, nullable=False)
    risk_level            = Column(String, nullable=False)
    reason                = Column(Text, nullable=False)
    predicted_stockout_date = Column(Date, nullable=True)


class AuditLog(Base):
    """
    Immutable append-only audit trail for every human and automated
    decision point in the procurement pipeline.

    Columns
    -------
    id        : Auto-increment primary key.
    timestamp : UTC datetime the event was recorded.
    action    : Short event code, e.g. "anomaly.approved", "po.rejected",
                "po.auto_created", "anomaly.flagged".
    actor     : Who triggered the event.
                "Procurement Officer" for human actions.
                "system" for automated pipeline actions.
    target_id : The primary key of the affected record
                (anomaly record key, PO ID, etc.).
    details   : Free-text JSON blob with any extra context
                (supplier_id, sku_id, anomaly_reason, cost, etc.).
    """
    __tablename__ = "audit_log"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow)
    action    = Column(String(64), nullable=False, index=True)
    actor     = Column(String(128), nullable=False, default="system")
    target_id = Column(String(256), nullable=False, index=True)
    details   = Column(Text, nullable=True, default="")

# Lifecycle helpers
def init_db():
    """Create all tables if they don't exist. Called on app startup."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency — yields a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_db_session() -> Session:
    """Return a standalone DB session. Caller must close it or use with context."""
    return SessionLocal()


def log_audit_event(
    action: str = None,
    target_id: str = None,
    actor: str = "system",
    details: str = "",
    db: Session = None,
    **kwargs,
) -> AuditLog:
    """
    Write one immutable row to the audit_log table.

    Parameters
    ----------
    action    : Short event code, e.g. "anomaly.approved", "po.rejected".
    target_id : Primary key of the affected record (anomaly key, PO ID, etc.).
    actor     : Who triggered the event (default "system").
    details   : Optional JSON string or free text with extra context.
    db        : Optional existing Session. If None, a new SessionLocal is used and closed.

    Returns the AuditLog ORM row (already committed).
    Never raises — exceptions are caught and logged so a DB hiccup
    can never break the endpoint that called it.
    """
    import logging as _logging
    _log = _logging.getLogger("audit")
    
    act = action or kwargs.get("action", "unknown")
    actr = actor or kwargs.get("actor", "system")
    tgt = target_id or kwargs.get("target_id", "")
    dtl = details or kwargs.get("details", "")

    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True
    try:
        entry = AuditLog(
            timestamp=datetime.utcnow(),
            action=act,
            actor=actr,
            target_id=tgt,
            details=dtl,
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        _log.info("[Audit] %s | actor=%s | target=%s | %s", act, actr, tgt, str(dtl)[:120])
        return entry
    except Exception as exc:
        _log.error("[Audit] Failed to write audit row: %s", exc)
        db.rollback()
        return None
    finally:
        if should_close:
            db.close()

