"""
database.py ΓÇö Production-ready SQLAlchemy persistence layer for ProcurementAI.
Default: SQLite file (./procurement.db) for zero setup.
Set DATABASE_URL env var to switch to PostgreSQL in production / Docker.
"""

import os
import json
import logging
from datetime import date, datetime
from typing import Optional, List, Dict, Any

from sqlalchemy import (
    create_engine, Column, String, Float, Integer,
    Boolean, Date, DateTime, Text, JSON, desc
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

logger = logging.getLogger("database")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./procurement.db")

# SQLite needs check_same_thread=False for FastAPI's thread pool
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, echo=False)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------
# ORM Models
# ---------------------------------------------------------------

class PurchaseOrderDB(Base):
    __tablename__ = "purchase_orders"

    po_id        = Column(String, primary_key=True, index=True)
    supplier_id  = Column(String, nullable=False)
    items        = Column(JSON, nullable=False)        # list of {sku_id, quantity, unit_price}
    total_cost   = Column(Float, nullable=False)
    reasoning    = Column(Text, nullable=False)
    status       = Column(String, nullable=False)      # auto_approved, pending_approval, rejected
    generated_by = Column(String, default="llm")       # llm, fallback
    created_at   = Column(Date, default=date.today)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RiskAlertDB(Base):
    __tablename__ = "risk_alerts"

    alert_id                = Column(String, primary_key=True, index=True)
    sku_id                  = Column(String, nullable=False)
    site_id                 = Column(String, nullable=False)
    risk_level              = Column(String, nullable=False)    # high, medium, low
    reason                  = Column(Text, nullable=False)
    predicted_stockout_date = Column(Date, nullable=True)
    created_at              = Column(DateTime, default=datetime.utcnow)


class EmailLogDB(Base):
    __tablename__ = "supplier_email_logs"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    supplier_id  = Column(String, nullable=True)
    sku_id       = Column(String, nullable=True)
    delay_days   = Column(Integer, nullable=True)
    summary      = Column(Text, nullable=False)
    raw_text     = Column(Text, nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow)


class ScenarioRunDB(Base):
    __tablename__ = "scenario_runs"

    id                         = Column(Integer, primary_key=True, autoincrement=True)
    lead_time_variability_pct  = Column(Float, nullable=False)
    demand_increase_pct        = Column(Float, nullable=False)
    new_stockout_count         = Column(Integer, nullable=False)
    cost_impact                = Column(Float, nullable=False)
    affected_skus              = Column(JSON, nullable=False)
    total_shortage_units       = Column(Float, default=0.0)
    created_at                 = Column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------
# Lifecycle Helpers & Dependency
# ---------------------------------------------------------------

def init_db():
    """Create all tables if they don't exist. Safe to call on startup."""
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables initialized successfully.")
    except Exception as e:
        logger.error("Failed to initialize database: %s", e)


def get_db():
    """FastAPI dependency ΓÇö yields a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------
# Repository CRUD Functions
# ---------------------------------------------------------------

def db_save_po(po_dict: dict) -> PurchaseOrderDB:
    """Insert or update a purchase order."""
    db = SessionLocal()
    try:
        po_id = po_dict.get("po_id")
        existing = db.query(PurchaseOrderDB).filter(PurchaseOrderDB.po_id == po_id).first()
        items = po_dict.get("items", [])
        # Ensure items are serializable dicts
        serializable_items = []
        for it in items:
            if hasattr(it, "model_dump"):
                serializable_items.append(it.model_dump())
            elif isinstance(it, dict):
                serializable_items.append(it)
            else:
                serializable_items.append(dict(it))

        created_at_val = po_dict.get("created_at")
        if isinstance(created_at_val, str):
            try:
                created_at_val = datetime.strptime(created_at_val, "%Y-%m-%d").date()
            except Exception:
                created_at_val = date.today()
        elif not isinstance(created_at_val, date):
            created_at_val = date.today()

        if existing:
            existing.supplier_id = po_dict.get("supplier_id", existing.supplier_id)
            existing.items = serializable_items
            existing.total_cost = float(po_dict.get("total_cost", existing.total_cost))
            existing.reasoning = po_dict.get("reasoning", existing.reasoning)
            existing.status = po_dict.get("status", existing.status)
            existing.generated_by = po_dict.get("generated_by", existing.generated_by)
            db.commit()
            db.refresh(existing)
            return existing
        else:
            new_po = PurchaseOrderDB(
                po_id=po_id,
                supplier_id=po_dict.get("supplier_id", ""),
                items=serializable_items,
                total_cost=float(po_dict.get("total_cost", 0.0)),
                reasoning=po_dict.get("reasoning", ""),
                status=po_dict.get("status", "pending_approval"),
                generated_by=po_dict.get("generated_by", "llm"),
                created_at=created_at_val,
            )
            db.add(new_po)
            db.commit()
            db.refresh(new_po)
            return new_po
    except Exception as e:
        db.rollback()
        logger.error("Error saving PO to DB: %s", e)
        raise
    finally:
        db.close()


def db_get_all_pos() -> List[dict]:
    """Retrieve all purchase orders from DB."""
    db = SessionLocal()
    try:
        rows = db.query(PurchaseOrderDB).order_by(desc(PurchaseOrderDB.created_at)).all()
        result = []
        for r in rows:
            result.append({
                "po_id": r.po_id,
                "supplier_id": r.supplier_id,
                "items": r.items,
                "total_cost": r.total_cost,
                "reasoning": r.reasoning,
                "status": r.status,
                "generated_by": r.generated_by,
                "created_at": r.created_at,
            })
        return result
    finally:
        db.close()


def db_update_po_status(po_id: str, status: str) -> Optional[dict]:
    """Update approval status of a purchase order."""
    db = SessionLocal()
    try:
        row = db.query(PurchaseOrderDB).filter(PurchaseOrderDB.po_id == po_id).first()
        if not row:
            return None
        row.status = status
        db.commit()
        db.refresh(row)
        return {
            "po_id": row.po_id,
            "supplier_id": row.supplier_id,
            "items": row.items,
            "total_cost": row.total_cost,
            "reasoning": row.reasoning,
            "status": row.status,
            "generated_by": row.generated_by,
            "created_at": row.created_at,
        }
    except Exception as e:
        db.rollback()
        logger.error("Error updating PO status in DB: %s", e)
        return None
    finally:
        db.close()


def db_save_alert(alert_dict: dict) -> RiskAlertDB:
    """Insert or update a risk alert."""
    db = SessionLocal()
    try:
        alert_id = alert_dict.get("alert_id")
        existing = db.query(RiskAlertDB).filter(RiskAlertDB.alert_id == alert_id).first()
        pred_date = alert_dict.get("predicted_stockout_date")
        if isinstance(pred_date, str):
            try:
                pred_date = datetime.strptime(pred_date, "%Y-%m-%d").date()
            except Exception:
                pred_date = None

        if existing:
            existing.risk_level = alert_dict.get("risk_level", existing.risk_level)
            existing.reason = alert_dict.get("reason", existing.reason)
            existing.predicted_stockout_date = pred_date
            db.commit()
            db.refresh(existing)
            return existing
        else:
            new_alert = RiskAlertDB(
                alert_id=alert_id,
                sku_id=alert_dict.get("sku_id", ""),
                site_id=alert_dict.get("site_id", "SITE-A"),
                risk_level=alert_dict.get("risk_level", "medium"),
                reason=alert_dict.get("reason", ""),
                predicted_stockout_date=pred_date,
            )
            db.add(new_alert)
            db.commit()
            db.refresh(new_alert)
            return new_alert
    except Exception as e:
        db.rollback()
        logger.error("Error saving alert to DB: %s", e)
        raise
    finally:
        db.close()


def db_get_all_alerts() -> List[dict]:
    """Retrieve all risk alerts from DB."""
    db = SessionLocal()
    try:
        rows = db.query(RiskAlertDB).order_by(desc(RiskAlertDB.created_at)).all()
        return [
            {
                "alert_id": r.alert_id,
                "sku_id": r.sku_id,
                "site_id": r.site_id,
                "risk_level": r.risk_level,
                "reason": r.reason,
                "predicted_stockout_date": r.predicted_stockout_date,
            }
            for r in rows
        ]
    finally:
        db.close()


def db_save_email_log(supplier_id: Optional[str], sku_id: Optional[str], delay_days: Optional[int], summary: str, raw_text: str) -> dict:
    """Save an incoming parsed supplier delay email."""
    db = SessionLocal()
    try:
        entry = EmailLogDB(
            supplier_id=supplier_id,
            sku_id=sku_id,
            delay_days=delay_days,
            summary=summary,
            raw_text=raw_text,
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return {
            "id": entry.id,
            "supplier_id": entry.supplier_id,
            "sku_id": entry.sku_id,
            "delay_days": entry.delay_days,
            "summary": entry.summary,
            "created_at": entry.created_at.isoformat() if entry.created_at else None,
        }
    except Exception as e:
        db.rollback()
        logger.error("Error saving email log: %s", e)
        return {"error": str(e)}
    finally:
        db.close()


def db_get_email_logs(limit: int = 20) -> List[dict]:
    """Retrieve recent parsed emails."""
    db = SessionLocal()
    try:
        rows = db.query(EmailLogDB).order_by(desc(EmailLogDB.created_at)).limit(limit).all()
        return [
            {
                "id": r.id,
                "supplier_id": r.supplier_id,
                "sku_id": r.sku_id,
                "delay_days": r.delay_days,
                "summary": r.summary,
                "raw_text": r.raw_text,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    finally:
        db.close()


def db_get_latest_delay_days_by_sku() -> Dict[str, int]:
    """Return the most recently persisted supplier delay for each SKU.

    The simulator uses this small read model so a saved email remains effective
    after the API process restarts.  It deliberately uses the existing email
    log table rather than introducing a second supplier-delay store.
    """
    db = SessionLocal()
    try:
        rows = db.query(EmailLogDB).order_by(desc(EmailLogDB.created_at)).all()
        latest: Dict[str, int] = {}
        for row in rows:
            if row.sku_id and row.delay_days is not None and row.sku_id not in latest:
                latest[row.sku_id] = row.delay_days
        return latest
    except Exception as e:
        # The simulator remains available while the database is being initialized.
        logger.warning("Could not read persisted supplier delays: %s", e)
        return {}
    finally:
        db.close()


def db_save_scenario_run(lead_time_pct: float, demand_pct: float, result: dict) -> dict:
    """Save a what-if simulation run result."""
    db = SessionLocal()
    try:
        run = ScenarioRunDB(
            lead_time_variability_pct=lead_time_pct,
            demand_increase_pct=demand_pct,
            new_stockout_count=result.get("newStockoutCount", 0),
            cost_impact=result.get("costImpact", 0.0),
            affected_skus=result.get("affectedSkus", []),
            total_shortage_units=result.get("totalShortageUnits", 0.0),
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        return {
            "id": run.id,
            "lead_time_variability_pct": run.lead_time_variability_pct,
            "demand_increase_pct": run.demand_increase_pct,
            "new_stockout_count": run.new_stockout_count,
            "cost_impact": run.cost_impact,
            "affected_skus": run.affected_skus,
            "total_shortage_units": run.total_shortage_units,
            "created_at": run.created_at.isoformat() if run.created_at else None,
        }
    except Exception as e:
        db.rollback()
        logger.error("Error saving scenario run: %s", e)
        return {"error": str(e)}
    finally:
        db.close()


def db_get_scenario_runs(limit: int = 10) -> List[dict]:
    """Retrieve recent scenario runs."""
    db = SessionLocal()
    try:
        rows = db.query(ScenarioRunDB).order_by(desc(ScenarioRunDB.created_at)).limit(limit).all()
        return [
            {
                "id": r.id,
                "lead_time_variability_pct": r.lead_time_variability_pct,
                "demand_increase_pct": r.demand_increase_pct,
                "new_stockout_count": r.new_stockout_count,
                "cost_impact": r.cost_impact,
                "affected_skus": r.affected_skus,
                "total_shortage_units": r.total_shortage_units,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    finally:
        db.close()
