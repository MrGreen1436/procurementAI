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
    Boolean, Date, Text, JSON,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

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
