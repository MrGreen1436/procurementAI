"""
database.py ΓÇö Production-ready SQLAlchemy persistence layer for ProcurementAI.
Default: SQLite file (./procurement.db) for zero setup.
Set DATABASE_URL env var to switch to PostgreSQL in production / Docker.
"""

import os
import uuid
import json
import logging
from datetime import date, datetime
from typing import Optional, List, Dict, Any

from sqlalchemy import (
    create_engine, Column, String, Float, Integer,
    Boolean, Date, DateTime, Text, JSON, desc, func
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


class SupplierCallDB(Base):
    __tablename__ = "supplier_calls"

    id            = Column(String, primary_key=True, index=True)
    call_sid      = Column(String, nullable=True, index=True)
    sku_id        = Column(String, nullable=False)
    supplier_name = Column(String, nullable=False)
    supplier_id   = Column(String, nullable=True)
    reason        = Column(Text, nullable=True)
    status        = Column(String, nullable=False)
    source        = Column(String, nullable=False)
    price         = Column(Float, nullable=True)
    transcription = Column(Text, nullable=True)
    lead_time_days= Column(Integer, nullable=True)
    availability  = Column(String, nullable=True)
    called_number = Column(String, nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)


class InventoryRecordDB(Base):
    __tablename__ = "inventory_records"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    date               = Column(String, nullable=True, index=True)
    sku_id             = Column(String, nullable=False, index=True)
    store_id           = Column(String, nullable=True, index=True)
    category           = Column(String, nullable=True, index=True)
    region             = Column(String, nullable=True)
    inventory_level    = Column(Integer, default=0)
    reorder_level      = Column(Integer, default=0)
    demand             = Column(Integer, default=0)
    price              = Column(Float, default=0.0)
    supplier_name      = Column(String, nullable=True)
    discount           = Column(Float, nullable=True)
    competitor_pricing = Column(Float, nullable=True)
    seasonality        = Column(String, nullable=True)
    weather_condition  = Column(String, nullable=True)
    holiday_promotion  = Column(Boolean, default=False)
    is_anomaly         = Column(Boolean, default=False)
    anomaly_reason     = Column(String, nullable=True)
    created_at         = Column(DateTime, default=datetime.utcnow)


class AuditLogDB(Base):
    __tablename__ = "audit_logs"

    id          = Column(String, primary_key=True, index=True)
    action      = Column(String, nullable=False, index=True)   # PO_APPROVED, PO_REJECTED, PO_AUTO_GENERATED, PO_PRICE_NEGOTIATED, etc.
    entity_type = Column(String, nullable=False, index=True)   # purchase_order, supplier_call, inventory, scenario, system
    entity_id   = Column(String, nullable=True, index=True)    # PO-AUTO-P0001, P0001, etc.
    actor       = Column(String, nullable=False)               # Procurement Officer, AI Voice Agent, AI Engine, System
    details     = Column(JSON, nullable=True)                  # Detailed payload (price, qty, changes, transcripts)
    status      = Column(String, default="success")            # success, warning, info, failure
    created_at  = Column(DateTime, default=datetime.utcnow, index=True)



class MarketEventDB(Base):
    __tablename__ = "market_events"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    event_text           = Column(Text, nullable=False)
    affected_category    = Column(String, nullable=True)
    affected_sku_id      = Column(String, nullable=True)
    price_delta_pct      = Column(Float, nullable=False)
    lead_time_delta_days = Column(Integer, nullable=False)
    severity             = Column(String, nullable=False)   # low, medium, high
    created_at           = Column(DateTime, default=datetime.utcnow)

# ---------------------------------------------------------------
# Lifecycle Helpers & Dependency

# ---------------------------------------------------------------

def init_db():
    """Create all tables if they don't exist. Safe to call on startup."""
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables initialized successfully.")
        db_seed_audit_logs_if_empty()
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


def db_save_supplier_call(entry: dict) -> dict:
    """Save or update a supplier voice call record in the database."""
    db = SessionLocal()
    try:
        existing = None
        if entry.get("id"):
            existing = db.query(SupplierCallDB).filter(SupplierCallDB.id == entry["id"]).first()
        elif entry.get("call_sid"):
            existing = db.query(SupplierCallDB).filter(SupplierCallDB.call_sid == entry["call_sid"]).first()

        if existing:
            if "price" in entry and entry["price"] is not None:
                existing.price = float(entry["price"])
            if "transcription" in entry and entry["transcription"]:
                existing.transcription = entry["transcription"]
            if "status" in entry:
                existing.status = entry["status"]
            if "availability" in entry:
                existing.availability = entry["availability"]
            db.commit()
            return {"id": existing.id, "status": existing.status, "price": existing.price}

        call_record = SupplierCallDB(
            id=entry.get("id", str(uuid.uuid4()) if "uuid" in globals() else os.urandom(8).hex()),
            call_sid=entry.get("call_sid"),
            sku_id=entry.get("sku_id", "UNKNOWN"),
            supplier_name=entry.get("supplier_name", "Supplier"),
            supplier_id=entry.get("supplier_id"),
            reason=entry.get("reason"),
            status=entry.get("status", "completed"),
            source=entry.get("source", "real_call"),
            price=float(entry["price"]) if entry.get("price") is not None else None,
            transcription=entry.get("transcription"),
            lead_time_days=entry.get("lead_time_days"),
            availability=entry.get("availability"),
            called_number=entry.get("called_number"),
        )
        db.add(call_record)
        db.commit()
        db.refresh(call_record)
        return {
            "id": call_record.id,
            "call_sid": call_record.call_sid,
            "sku_id": call_record.sku_id,
            "supplier_name": call_record.supplier_name,
            "price": call_record.price,
            "status": call_record.status,
        }
    except Exception as e:
        db.rollback()
        logger.error("Error saving supplier call to DB: %s", e)
        return {"error": str(e)}
    finally:
        db.close()


def db_update_supplier_call_price(call_sid: str, price: Optional[float], transcription: str = "", sku_id: str = "UNKNOWN", supplier_name: str = "Supplier") -> dict:
    """Update quoted price and transcription for a call by its Call SID, or insert new record."""
    db = SessionLocal()
    try:
        row = None
        if call_sid:
            row = db.query(SupplierCallDB).filter(SupplierCallDB.call_sid == call_sid).first()
        if not row and sku_id != "UNKNOWN":
            row = db.query(SupplierCallDB).filter(SupplierCallDB.sku_id == sku_id).order_by(desc(SupplierCallDB.created_at)).first()

        if row:
            if price is not None:
                row.price = price
            if transcription:
                row.transcription = transcription
            if call_sid and not row.call_sid:
                row.call_sid = call_sid
            row.availability = "in_stock"
            row.status = "completed"
            db.commit()
            return {"call_sid": row.call_sid, "price": row.price, "transcription": row.transcription}
        else:
            new_record = SupplierCallDB(
                id=str(uuid.uuid4()),
                call_sid=call_sid,
                sku_id=sku_id,
                supplier_name=supplier_name,
                supplier_id="SUP-01",
                reason="Price negotiation",
                status="completed",
                source="real_call",
                price=price,
                transcription=transcription,
                lead_time_days=3,
                availability="in_stock",
                called_number=os.environ.get("DEMO_SUPPLIER_PHONE_NUMBER", ""),
            )
            db.add(new_record)
            db.commit()
            return {"call_sid": call_sid, "price": price, "transcription": transcription}
    except Exception as e:
        db.rollback()
        logger.error("Error updating supplier call price in DB: %s", e)
        return {"error": str(e)}
    finally:
        db.close()


def db_get_supplier_calls(limit: int = 50) -> List[dict]:
    """Retrieve recent supplier calls from DB."""
    db = SessionLocal()
    try:
        rows = db.query(SupplierCallDB).order_by(desc(SupplierCallDB.created_at)).limit(limit).all()
        return [
            {
                "id": r.id,
                "call_sid": r.call_sid,
                "sku_id": r.sku_id,
                "supplier_name": r.supplier_name,
                "supplier_id": r.supplier_id,
                "reason": r.reason,
                "status": r.status,
                "source": r.source,
                "price": r.price,
                "transcription": r.transcription,
                "lead_time_days": r.lead_time_days,
                "availability": r.availability,
                "called_number": r.called_number,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    finally:
        db.close()


def db_get_latest_supplier_quote(sku_id: str) -> Optional[dict]:
    """
    Retrieve the most recent quoted price obtained from an AI supplier call for a SKU.
    Matches exact or case-insensitively. Returns dict with price, supplier_name, transcription, etc.
    """
    db = SessionLocal()
    try:
        clean = sku_id.strip()
        row = (
            db.query(SupplierCallDB)
            .filter(func.lower(SupplierCallDB.sku_id) == clean.lower())
            .filter(SupplierCallDB.price.isnot(None))
            .filter(SupplierCallDB.price > 0)
            .order_by(desc(SupplierCallDB.created_at))
            .first()
        )
        if not row:
            # Check if any SKU contains clean
            row = (
                db.query(SupplierCallDB)
                .filter(SupplierCallDB.price.isnot(None))
                .filter(SupplierCallDB.price > 0)
                .filter(SupplierCallDB.sku_id.ilike(f"%{clean}%"))
                .order_by(desc(SupplierCallDB.created_at))
                .first()
            )

        if row:
            return {
                "sku_id": row.sku_id,
                "price": float(row.price),
                "supplier_name": row.supplier_name,
                "transcription": row.transcription,
                "call_sid": row.call_sid,
                "status": row.status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        return None
    except Exception as e:
        logger.error("Error retrieving latest supplier quote for %s: %s", sku_id, e)
        return None
    finally:
        db.close()


# ---------------------------------------------------------------
# Inventory Record CRUD & Aggregation Functions
# ---------------------------------------------------------------

def db_clear_inventory():
    """Delete all records from inventory_records table."""
    db = SessionLocal()
    try:
        db.query(InventoryRecordDB).delete()
        db.commit()
        logger.info("Cleared inventory_records table.")
    except Exception as e:
        db.rollback()
        logger.error("Error clearing inventory table: %s", e)
    finally:
        db.close()


def db_bulk_insert_inventory(records: List[dict], batch_size: int = 2000):
    """Bulk insert normalized inventory records with batching for high speed."""
    if not records:
        return
    db = SessionLocal()
    try:
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            db.bulk_insert_mappings(InventoryRecordDB, batch)
            db.commit()
        logger.info("Inserted %d inventory records into DB", len(records))
    except Exception as e:
        db.rollback()
        logger.error("Error bulk inserting inventory records: %s", e)
        raise
    finally:
        db.close()


def db_get_inventory_count() -> int:
    """Return total row count in inventory_records table."""
    db = SessionLocal()
    try:
        return db.query(InventoryRecordDB).count()
    except Exception as e:
        logger.error("Error fetching inventory count: %s", e)
        return 0
    finally:
        db.close()


def db_get_inventory_summary(site_id: str = None) -> List[dict]:
    """
    Compute CategorySummary[] directly from the latest inventory state in the database.
    Returns: [{category, skuCount, atRiskCount, totalValue}, ...]
    """
    sku_map = db_get_sku_state_map(site_id)
    if not sku_map:
        return []

    cat_map = {}
    for sku, info in sku_map.items():
        cat = info.get("category") or "General Supplies"
        if cat not in cat_map:
            cat_map[cat] = {
                "category": cat,
                "skuCount": 0,
                "atRiskCount": 0,
                "totalValue": 0.0,
            }
        cat_map[cat]["skuCount"] += 1
        stock = info.get("current_stock", 0)
        reorder = info.get("reorder_point", 50)
        price = info.get("avg_price", 55.0)

        if stock <= reorder:
            cat_map[cat]["atRiskCount"] += 1

        cat_map[cat]["totalValue"] += round(stock * price, 2)

    return sorted(list(cat_map.values()), key=lambda x: x["category"])


def db_get_inventory_transactions(category: Optional[str] = None, site_id: Optional[str] = None, limit: int = 300, offset: int = 0) -> List[dict]:
    """Retrieve paginated inventory transaction records directly from DB."""
    db = SessionLocal()
    try:
        from sqlalchemy import func
        q = db.query(InventoryRecordDB)
        if category and category.lower() != "all":
            q = q.filter(func.lower(InventoryRecordDB.category) == category.lower())
        if site_id:
            q = q.filter(InventoryRecordDB.store_id == site_id)
        
        rows = q.order_by(desc(InventoryRecordDB.id)).offset(offset).limit(limit).all()
        return [
            {
                "id": r.id,
                "date": r.date,
                "store_id": r.store_id or "S001",
                "product_id": r.sku_id,
                "category": r.category or "General Supplies",
                "region": r.region or "North",
                "inventory_level": r.inventory_level or 0,
                "reorder_level": r.reorder_level or 0,
                "price": round(float(r.price or 0.0), 2),
                "supplier_name": r.supplier_name or f"Supplier for {r.sku_id}",
                "discount": r.discount,
                "competitor_pricing": r.competitor_pricing,
                "seasonality": r.seasonality or "Normal",
                "weather_condition": r.weather_condition or "Clear",
                "holiday_promotion": bool(r.holiday_promotion),
                "is_anomaly": bool(r.is_anomaly),
                "anomaly_reason": r.anomaly_reason,
            }
            for r in rows
        ]
    except Exception as e:
        logger.error("Error fetching inventory transactions from DB: %s", e)
        return []
    finally:
        db.close()


def db_adjust_inventory_stock(store_id: str, product_id: str, new_qty: int) -> bool:
    """Update stock level for a product in DB."""
    db = SessionLocal()
    try:
        q = db.query(InventoryRecordDB).filter(InventoryRecordDB.sku_id == product_id)
        if store_id:
            q = q.filter(InventoryRecordDB.store_id == store_id)
        
        records = q.order_by(desc(InventoryRecordDB.id)).limit(10).all()
        for rec in records:
            rec.inventory_level = new_qty
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logger.error("Error adjusting inventory stock in DB: %s", e)
        return False
    finally:
        db.close()


BALANCED_INVENTORY_DISTRIBUTION = {
    # Deficit / High-Risk items (stockout alerts + PO triggers)
    "P0001": {"stock": 180,  "reorder": 950},   # Groceries
    "P0004": {"stock": 120,  "reorder": 950},   # Electronics
    "P0009": {"stock": 150,  "reorder": 950},   # Clothing

    # Excess / Surplus inventory items (positive surplus valuation)
    "P0002": {"stock": 5400, "reorder": 1800},  # Toys
    "P0005": {"stock": 5800, "reorder": 1800},  # Clothing
    "P0007": {"stock": 5600, "reorder": 1800},  # Clothing
    "P0014": {"stock": 5500, "reorder": 1800},  # Furniture
    "P0016": {"stock": 5200, "reorder": 1800},  # Electronics

    # Optimal / Healthy balanced items
    "P0003": {"stock": 2800, "reorder": 1800},  # Groceries
    "P0006": {"stock": 2900, "reorder": 1800},  # Toys
    "P0008": {"stock": 2750, "reorder": 1800},  # Clothing
    "P0010": {"stock": 2950, "reorder": 1800},  # Electronics
    "P0011": {"stock": 2850, "reorder": 1800},  # Furniture
    "P0012": {"stock": 2700, "reorder": 1800},  # Clothing
    "P0013": {"stock": 2800, "reorder": 1800},  # Toys
    "P0015": {"stock": 2900, "reorder": 1800},  # Clothing
    "P0017": {"stock": 3100, "reorder": 1800},  # Clothing
    "P0018": {"stock": 2850, "reorder": 1800},  # Clothing
    "P0019": {"stock": 3050, "reorder": 1800},  # Toys
    "P0020": {"stock": 3200, "reorder": 1800},  # Furniture
}

def db_apply_balanced_inventory_levels():
    """
    Ensure the latest inventory records in the database reflect a realistic,
    balanced distribution: some at-risk items, some excess items, and mostly optimal items.
    """
    db = SessionLocal()
    try:
        from sqlalchemy import func
        max_date = db.query(func.max(InventoryRecordDB.date)).scalar()
        if not max_date:
            return

        for sku, config in BALANCED_INVENTORY_DISTRIBUTION.items():
            recs = db.query(InventoryRecordDB).filter(
                InventoryRecordDB.sku_id == sku,
                InventoryRecordDB.date == max_date
            ).all()
            if recs:
                for r in recs:
                    r.inventory_level = config["stock"]
                    r.reorder_level = config["reorder"]
            else:
                latest = db.query(InventoryRecordDB).filter(
                    InventoryRecordDB.sku_id == sku
                ).order_by(desc(InventoryRecordDB.id)).first()
                if latest:
                    latest.inventory_level = config["stock"]
                    latest.reorder_level = config["reorder"]

        db.commit()
        logger.info("Applied balanced inventory distribution to latest database records.")
    except Exception as e:
        db.rollback()
        logger.error("Failed to apply balanced inventory levels: %s", e)
    finally:
        db.close()


def db_seed_if_empty():
    """
    Ensure the database is never empty. If inventory_records has 0 rows,
    automatically seeds from the enriched dataset or demand sample.
    """
    if db_get_inventory_count() > 0:
        return True

    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "retail_store_inventory_enriched.xlsx"),
        os.path.join(base_dir, "retail_store_inventory_enriched.csv"),
        os.path.join(base_dir, "demand_sample.csv"),
    ]

    target_file = None
    for cand in candidates:
        if os.path.exists(cand):
            target_file = cand
            break

    if not target_file:
        logger.warning("No seed dataset found to populate database.")
        return False

    try:
        import pandas as pd
        if target_file.endswith(".xlsx"):
            df = pd.read_excel(target_file)
        else:
            df = pd.read_csv(target_file)

        if df.empty:
            return False

        logger.info("Auto-seeding database from %s (%d rows)...", os.path.basename(target_file), len(df))

        def find_col(aliases):
            for a in aliases:
                a_clean = str(a).strip().lower().replace(" ", "_").replace("-", "_")
                for c in df.columns:
                    c_clean = str(c).strip().lower().replace(" ", "_").replace("-", "_")
                    if c_clean == a_clean:
                        return c
            return None

        date_c     = find_col(["date", "transaction_date", "day", "Date", "order_date"])
        store_c    = find_col(["store_id", "store", "Store ID", "warehouse_id"])
        product_c  = find_col(["product_id", "sku_id", "sku", "Product ID", "item_id", "item"])
        cat_c      = find_col(["category", "Category", "dept"])
        region_c   = find_col(["region", "Region", "zone"])
        inv_c      = find_col(["inventory_level", "Inventory Level", "stock", "current_stock"])
        reorder_c  = find_col(["reorder_level", "Reorder Level", "reorder_point"])
        price_c    = find_col(["price", "Price", "unit_price", "cost", "selling_price"])
        sup_c      = find_col(["supplier_name", "Supplier Name", "vendor", "vendors"])
        disc_c     = find_col(["discount", "Discount"])
        comp_c     = find_col(["competitor_pricing", "Competitor Pricing"])
        season_c   = find_col(["seasonality", "Seasonality"])
        weather_c  = find_col(["weather_condition", "Weather Condition", "weather"])
        promo_c    = find_col(["holiday_promotion", "Holiday/Promotion", "promotion", "promo"])
        anomaly_c  = find_col(["is_anomaly", "Is Anomaly", "anomaly"])
        reason_c   = find_col(["anomaly_reason", "Anomaly Reason"])
        demand_c   = find_col(["units_sold", "units sold", "demand", "sales", "quantity", "qty", "units"])

        records = []
        for idx, row in df.iterrows():
            sku_val = str(row[product_c]).strip() if product_c and pd.notna(row.get(product_c)) else f"SKU_{idx % 7 + 1:03d}"
            cat_val = str(row[cat_c]).strip() if cat_c and pd.notna(row.get(cat_c)) else "General Supplies"
            
            raw_inv = row.get(inv_c) if inv_c else None
            try: inv_val = int(float(raw_inv)) if pd.notna(raw_inv) else 100
            except Exception: inv_val = 100

            raw_reorder = row.get(reorder_c) if reorder_c else None
            try: reorder_val = int(float(raw_reorder)) if pd.notna(raw_reorder) else 50
            except Exception: reorder_val = 50

            raw_price = row.get(price_c) if price_c else None
            try: price_val = round(float(raw_price), 2) if pd.notna(raw_price) else 100.0
            except Exception: price_val = 100.0

            raw_demand = row.get(demand_c) if demand_c else None
            try: demand_val = int(float(raw_demand)) if pd.notna(raw_demand) else 0
            except Exception: demand_val = 0

            d_val = row.get(date_c) if date_c else None
            date_str = str(d_val).split("T")[0].split(" ")[0] if pd.notna(d_val) else datetime.utcnow().strftime("%Y-%m-%d")

            records.append({
                "date": date_str,
                "sku_id": sku_val,
                "store_id": str(row.get(store_c, "S001")) if store_c and pd.notna(row.get(store_c)) else "S001",
                "category": cat_val,
                "region": str(row.get(region_c, "North")) if region_c and pd.notna(row.get(region_c)) else "North",
                "inventory_level": inv_val,
                "reorder_level": reorder_val,
                "demand": demand_val,
                "price": price_val,
                "supplier_name": str(row.get(sup_c, f"Supplier for {sku_val}")) if sup_c and pd.notna(row.get(sup_c)) else f"Supplier for {sku_val}",
                "discount": float(row.get(disc_c)) if disc_c and pd.notna(row.get(disc_c)) else None,
                "competitor_pricing": float(row.get(comp_c)) if comp_c and pd.notna(row.get(comp_c)) else None,
                "seasonality": str(row.get(season_c)) if season_c and pd.notna(row.get(season_c)) else "Normal",
                "weather_condition": str(row.get(weather_c)) if weather_c and pd.notna(row.get(weather_c)) else "Clear",
                "holiday_promotion": bool(row.get(promo_c)) if promo_c and pd.notna(row.get(promo_c)) else False,
                "is_anomaly": bool(row.get(anomaly_c)) if anomaly_c and pd.notna(row.get(anomaly_c)) else False,
                "anomaly_reason": str(row.get(reason_c)) if reason_c and pd.notna(row.get(reason_c)) else None,
            })

        db_bulk_insert_inventory(records)
        logger.info("Successfully seeded database with %d records.", len(records))
        db_apply_balanced_inventory_levels()
        return True
    except Exception as e:
        logger.error("Failed to auto-seed database: %s", e)
        return False


def db_get_sku_state_map(site_id: str = None) -> Dict[str, dict]:
    """
    Query distinct SKUs from the database and aggregate stock, reorder point,
    pricing, and supplier info.
    Returns: {sku_id: {sku_id, site_id, current_stock, reorder_point, avg_price, supplier_name, category, avg_daily_demand}}
    """
    db = SessionLocal()
    try:
        from sqlalchemy import func, distinct
        q = db.query(distinct(InventoryRecordDB.sku_id))
        if site_id:
            q = q.filter(InventoryRecordDB.store_id == site_id)
        skus = [r[0] for r in q.all()]
        if not skus:
            return {}

        result = {}
        for sku in skus:
            q_latest = db.query(InventoryRecordDB).filter(InventoryRecordDB.sku_id == sku)
            if site_id:
                q_latest = q_latest.filter(InventoryRecordDB.store_id == site_id)
            latest = q_latest.order_by(desc(InventoryRecordDB.id)).first()
            if not latest:
                continue

            q_stats = db.query(func.avg(InventoryRecordDB.price), func.avg(InventoryRecordDB.demand)).filter(InventoryRecordDB.sku_id == sku)
            if site_id:
                q_stats = q_stats.filter(InventoryRecordDB.store_id == site_id)
            avg_stats = q_stats.first()

            avg_price = round(float(avg_stats[0] or 100.0), 2)
            avg_demand = max(1.0, float(avg_stats[1] or 10.0))

            current_stock = int(latest.inventory_level if latest.inventory_level is not None else 50)
            reorder_point = int(latest.reorder_level if latest.reorder_level is not None and latest.reorder_level > 0 else int(avg_demand * 14))

            result[sku] = {
                "sku_id": sku,
                "site_id": latest.store_id or "SITE-A",
                "current_stock": current_stock,
                "reorder_point": reorder_point,
                "avg_price": avg_price,
                "supplier_name": latest.supplier_name or f"Supplier for {sku}",
                "category": latest.category or "General Supplies",
                "avg_daily_demand": avg_demand,
            }
        return result
    except Exception as e:
        logger.error("Error building SKU state map from DB: %s", e)
        return {}
    finally:
        db.close()


def db_get_sku_demand_history(sku_id: str, limit: int = 180) -> List[dict]:
    """Retrieve historical demand, price, and promotion for a SKU directly from the database."""
    db = SessionLocal()
    try:
        rows = db.query(
            InventoryRecordDB.date,
            InventoryRecordDB.demand,
            InventoryRecordDB.price,
            InventoryRecordDB.holiday_promotion
        ).filter(InventoryRecordDB.sku_id == sku_id).order_by(InventoryRecordDB.id.asc()).limit(limit).all()

        return [
            {
                "date": r[0],
                "demand": int(r[1] or 0),
                "price": float(r[2] or 100.0),
                "promotion": 1 if r[3] else 0,
            }
            for r in rows
        ]
    except Exception as e:
        logger.error("Error querying SKU demand history: %s", e)
        return []
    finally:
        db.close()


def db_get_inventory_history_timeline(days: int = 90) -> List[dict]:
    """
    Fetch daily historical actual demand timeline directly from DB for timeline charts.
    Returns daily data points for 'ALL' aggregate and for each top active SKU.
    """
    db = SessionLocal()
    try:
        from sqlalchemy import func

        # 1. Get the distinct dates in descending order up to `days`
        distinct_dates = [
            r[0] for r in db.query(InventoryRecordDB.date)
            .distinct()
            .order_by(InventoryRecordDB.date.desc())
            .limit(days)
            .all()
        ]
        if not distinct_dates:
            return []

        min_date = min(distinct_dates)
        max_date = max(distinct_dates)

        # 2. Get the top active SKUs
        top_skus = [
            r[0] for r in db.query(InventoryRecordDB.sku_id)
            .distinct()
            .order_by(InventoryRecordDB.sku_id.asc())
            .limit(16)
            .all()
        ]

        # 3. Query daily actual demand per SKU for these dates
        sku_rows = db.query(
            InventoryRecordDB.date,
            InventoryRecordDB.sku_id,
            func.sum(InventoryRecordDB.demand).label("tot_demand")
        ).filter(
            InventoryRecordDB.date >= min_date,
            InventoryRecordDB.date <= max_date,
            InventoryRecordDB.sku_id.in_(top_skus)
        ).group_by(
            InventoryRecordDB.date,
            InventoryRecordDB.sku_id
        ).all()

        timeline = []
        for r in sku_rows:
            d_str = str(r[0])
            s_id = str(r[1])
            val = int(r[2] or 0)
            timeline.append({
                "date": d_str,
                "sku": s_id,
                "actualLevel": val,
                "forecastedLevel": None,
                "etsForecastedLevel": None,
                "lstmForecastedLevel": None,
            })

        # 4. Also compute and include 'ALL' aggregate points
        agg_rows = db.query(
            InventoryRecordDB.date,
            func.sum(InventoryRecordDB.demand).label("tot_demand")
        ).filter(
            InventoryRecordDB.date >= min_date,
            InventoryRecordDB.date <= max_date
        ).group_by(InventoryRecordDB.date).all()

        for r in agg_rows:
            timeline.append({
                "date": str(r[0]),
                "sku": "ALL",
                "actualLevel": int(r[1] or 0),
                "forecastedLevel": None,
                "etsForecastedLevel": None,
                "lstmForecastedLevel": None,
            })

        timeline.sort(key=lambda x: (x["date"], x["sku"]))
        return timeline
    except Exception as e:
        logger.error("Error fetching inventory history timeline from DB: %s", e)
        return []
    finally:
        db.close()


# ---------------------------------------------------------------
# Audit Trail CRUD & History Seeding Functions
# ---------------------------------------------------------------

def db_log_audit_event(
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    actor: str = "System",
    details: Optional[dict] = None,
    status: str = "success",
) -> dict:
    """Append a new audit trail record to the audit_logs table."""
    db = SessionLocal()
    try:
        log_id = f"AUDIT-{uuid.uuid4().hex[:8].upper()}"
        record = AuditLogDB(
            id=log_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            actor=actor,
            details=details or {},
            status=status,
            created_at=datetime.utcnow(),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return {
            "id": record.id,
            "action": record.action,
            "entityType": record.entity_type,
            "entityId": record.entity_id,
            "actor": record.actor,
            "details": record.details,
            "status": record.status,
            "createdAt": record.created_at.isoformat(),
        }
    except Exception as e:
        db.rollback()
        logger.error("Error logging audit event: %s", e)
        return {}
    finally:
        db.close()


def db_get_audit_logs(
    entity_type: Optional[str] = None,
    action: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """Retrieve audit trail logs with filtering, search, and pagination."""
    db = SessionLocal()
    try:
        query = db.query(AuditLogDB)
        if entity_type and entity_type.lower() != "all":
            query = query.filter(func.lower(AuditLogDB.entity_type) == entity_type.lower().strip())
        if action and action.lower() != "all":
            query = query.filter(func.lower(AuditLogDB.action) == action.lower().strip())
        if search and search.strip():
            s = f"%{search.strip().lower()}%"
            query = query.filter(
                (func.lower(AuditLogDB.action).ilike(s)) |
                (func.lower(AuditLogDB.entity_id).ilike(s)) |
                (func.lower(AuditLogDB.actor).ilike(s)) |
                (func.lower(AuditLogDB.id).ilike(s))
            )
        total = query.count()
        rows = query.order_by(desc(AuditLogDB.created_at)).offset(offset).limit(limit).all()
        logs = [
            {
                "id": r.id,
                "action": r.action,
                "entityType": r.entity_type,
                "entityId": r.entity_id,
                "actor": r.actor,
                "details": r.details or {},
                "status": r.status,
                "createdAt": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
        return {"total": total, "logs": logs}
    finally:
        db.close()


def db_seed_audit_logs_if_empty():
    """Seed initial audit trail events from existing database records if audit_logs is empty."""
    db = SessionLocal()
    try:
        count = db.query(AuditLogDB).count()
        if count > 0:
            return

        initial_events = []
        now = datetime.utcnow()

        # 1. System initialization event
        initial_events.append(AuditLogDB(
            id="AUDIT-INIT-001",
            action="SYSTEM_INITIALIZED",
            entity_type="system",
            entity_id="PROCURE-CORE",
            actor="System",
            details={"message": "ProcurementAI core engine initialized with SQLite persistence layer and live audit logging."},
            status="info",
            created_at=now,
        ))

        # 2. Add events from existing purchase orders
        pos = db.query(PurchaseOrderDB).all()
        for po in pos:
            first_item = po.items[0] if po.items and len(po.items) > 0 else {}
            sku = first_item.get("sku_id", "UNKNOWN")
            unit_price = first_item.get("unit_price", 0.0)
            qty = first_item.get("quantity", 0)

            initial_events.append(AuditLogDB(
                id=f"AUDIT-PO-GEN-{po.po_id[-6:]}",
                action="PO_AUTO_GENERATED",
                entity_type="purchase_order",
                entity_id=po.po_id,
                actor="AI Procurement Engine",
                details={
                    "sku": sku,
                    "quantity": qty,
                    "unit_price": unit_price,
                    "total_cost": po.total_cost,
                    "reasoning": po.reasoning,
                    "status": po.status,
                },
                status="info",
                created_at=datetime.combine(po.created_at, datetime.min.time()) if po.created_at else now,
            ))

            if po.status in ["auto_approved", "approved"]:
                initial_events.append(AuditLogDB(
                    id=f"AUDIT-PO-APP-{po.po_id[-6:]}",
                    action="PO_APPROVED",
                    entity_type="purchase_order",
                    entity_id=po.po_id,
                    actor="Procurement Officer",
                    details={
                        "sku": sku,
                        "total_cost": po.total_cost,
                        "decision": "Approved for supplier purchase order transmission",
                    },
                    status="success",
                    created_at=now,
                ))

        # 3. Add events from supplier calls
        calls = db.query(SupplierCallDB).all()
        for c in calls:
            initial_events.append(AuditLogDB(
                id=f"AUDIT-CALL-{c.id[:6]}",
                action="PO_PRICE_NEGOTIATED" if (c.price and c.price > 0) else "SUPPLIER_CALL_PLACED",
                entity_type="supplier_call",
                entity_id=c.sku_id,
                actor="AI Voice Agent",
                details={
                    "sku": c.sku_id,
                    "supplier": c.supplier_name,
                    "quoted_price": c.price,
                    "transcription": c.transcription,
                    "call_sid": c.call_sid,
                    "call_status": c.status,
                },
                status="success" if c.status == "completed" else "warning",
                created_at=c.created_at or now,
            ))

        # 4. Add events from scenario runs
        scenarios = db.query(ScenarioRunDB).all()
        for sc in scenarios:
            initial_events.append(AuditLogDB(
                id=f"AUDIT-SCENARIO-{sc.id}",
                action="SCENARIO_SIMULATION_RUN",
                entity_type="scenario",
                entity_id=f"RUN-{sc.id}",
                actor="Supply Chain Analyst",
                details={
                    "lead_time_variability_pct": sc.lead_time_variability_pct,
                    "demand_increase_pct": sc.demand_increase_pct,
                    "new_stockout_count": sc.new_stockout_count,
                    "cost_impact": sc.cost_impact,
                    "affected_skus": sc.affected_skus,
                },
                status="info",
                created_at=sc.created_at or now,
            ))

        for ev in initial_events:
            db.add(ev)
        db.commit()
        logger.info("[DB] Backfilled %d initial audit log events.", len(initial_events))
    except Exception as e:
        db.rollback()
        logger.warning("[DB] Could not seed audit logs: %s", e)
    finally:
        db.close()

# ---------------------------------------------------------------
# Project Budget Table & Functions
# ---------------------------------------------------------------

class ProjectBudgetDB(Base):
    __tablename__ = "project_budgets"

    project_id       = Column(String, primary_key=True, index=True)
    allocated_budget = Column(Float, nullable=False)
    spent_amount     = Column(Float, nullable=False, default=0.0)
    remaining_budget = Column(Float, nullable=False)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def db_get_budget(project_id: str) -> Optional[dict]:
    """Return the budget row for a project as a dict, or None if not found."""
    db = SessionLocal()
    try:
        row = db.query(ProjectBudgetDB).filter(ProjectBudgetDB.project_id == project_id).first()
        if row is None:
            return None
        return {
            "project_id":       row.project_id,
            "allocated_budget": row.allocated_budget,
            "spent_amount":     row.spent_amount,
            "remaining_budget": row.remaining_budget,
            "updated_at":       row.updated_at.isoformat() if row.updated_at else None,
        }
    finally:
        db.close()


def db_set_budget(project_id: str, allocated_budget: float) -> dict:
    """Create or update the budget row for a project.
    Sets remaining_budget = allocated_budget - spent_amount.
    """
    db = SessionLocal()
    try:
        row = db.query(ProjectBudgetDB).filter(ProjectBudgetDB.project_id == project_id).first()
        if row is None:
            row = ProjectBudgetDB(
                project_id=project_id,
                allocated_budget=allocated_budget,
                spent_amount=0.0,
                remaining_budget=allocated_budget,
                updated_at=datetime.utcnow(),
            )
            db.add(row)
        else:
            row.allocated_budget = allocated_budget
            row.remaining_budget = allocated_budget - row.spent_amount
            row.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(row)
        return {
            "project_id":       row.project_id,
            "allocated_budget": row.allocated_budget,
            "spent_amount":     row.spent_amount,
            "remaining_budget": row.remaining_budget,
            "updated_at":       row.updated_at.isoformat() if row.updated_at else None,
        }
    except Exception as e:
        db.rollback()
        logger.error("[DB] db_set_budget failed: %s", e)
        raise
    finally:
        db.close()


def db_deduct_budget(project_id: str, amount: float) -> dict:
    """Subtract amount from remaining_budget and add it to spent_amount, then commit.
    Raises ValueError if the project budget row does not exist.
    """
    db = SessionLocal()
    try:
        row = db.query(ProjectBudgetDB).filter(ProjectBudgetDB.project_id == project_id).first()
        if row is None:
            raise ValueError(f"No budget found for project_id='{project_id}'")
        row.spent_amount     += amount
        row.remaining_budget -= amount
        row.updated_at        = datetime.utcnow()
        db.commit()
        db.refresh(row)
        return {
            "project_id":       row.project_id,
            "allocated_budget": row.allocated_budget,
            "spent_amount":     row.spent_amount,
            "remaining_budget": row.remaining_budget,
            "updated_at":       row.updated_at.isoformat() if row.updated_at else None,
        }
    except Exception as e:
        db.rollback()
        logger.error("[DB] db_deduct_budget failed: %s", e)
        raise
    finally:
        db.close()



def db_get_warehouses_summary() -> list[dict]:
    with SessionLocal() as db:
        # We want to group by store_id and compute total_skus, low_stock_count, and status
        # Since we have multiple records for the same SKU over time, we should look at the LATEST date per SKU per store.
        
        # Subquery to get the latest record ID for each SKU in each store
        subq = db.query(
            InventoryRecordDB.store_id,
            InventoryRecordDB.sku_id,
            func.max(InventoryRecordDB.date).label("max_date")
        ).group_by(InventoryRecordDB.store_id, InventoryRecordDB.sku_id).subquery()

        # Join to get the actual records
        records = db.query(InventoryRecordDB).join(
            subq,
            (InventoryRecordDB.store_id == subq.c.store_id) &
            (InventoryRecordDB.sku_id == subq.c.sku_id) &
            (InventoryRecordDB.date == subq.c.max_date)
        ).all()
        
        store_map = {}
        for r in records:
            if r.store_id not in store_map:
                store_map[r.store_id] = {"total_skus": 0, "low_stock_count": 0}
            store_map[r.store_id]["total_skus"] += 1
            if r.inventory_level < r.reorder_level:
                store_map[r.store_id]["low_stock_count"] += 1
                
        results = []
        for store_id, data in store_map.items():
            st = "healthy"
            if data["low_stock_count"] > 0:
                if data["low_stock_count"] < 0.2 * data["total_skus"]:
                    st = "at_risk"
                else:
                    st = "critical"
            results.append({
                "store_id": store_id,
                "total_skus": data["total_skus"],
                "low_stock_count": data["low_stock_count"],
                "status": st
            })
        return results

def db_save_market_event(event_data: dict) -> dict:
    with SessionLocal() as db:
        evt = MarketEventDB(**event_data)
        db.add(evt)
        db.commit()
        db.refresh(evt)
        return {
            "id": evt.id,
            "event_text": evt.event_text,
            "affected_category": evt.affected_category,
            "affected_sku_id": evt.affected_sku_id,
            "price_delta_pct": evt.price_delta_pct,
            "lead_time_delta_days": evt.lead_time_delta_days,
            "severity": evt.severity,
        }

def db_update_inventory_price(sku_id: str, category: str, price_delta_pct: float) -> list[str]:
    # Update latest inventory records with the new price
    affected_skus = []
    with SessionLocal() as db:
        query = db.query(InventoryRecordDB)
        if sku_id:
            query = query.filter(InventoryRecordDB.sku_id == sku_id)
        elif category:
            query = query.filter(InventoryRecordDB.category == category)
            
        # Get distinct SKUs
        distinct_skus = {r.sku_id for r in query.all()}
        affected_skus = list(distinct_skus)
        
        # Subquery to update only the latest record for each SKU
        for sku in affected_skus:
            latest = db.query(InventoryRecordDB).filter(InventoryRecordDB.sku_id == sku).order_by(desc(InventoryRecordDB.date)).first()
            if latest:
                old_price = latest.price
                new_price = old_price * (1.0 + price_delta_pct / 100.0)
                latest.price = new_price
        db.commit()
    return affected_skus

def db_find_transfer_candidates(sku_id: str, needed_qty: int) -> list[dict]:
    with SessionLocal() as db:
        # Find latest records for this sku
        subq = db.query(
            InventoryRecordDB.store_id,
            func.max(InventoryRecordDB.date).label("max_date")
        ).filter(InventoryRecordDB.sku_id == sku_id).group_by(InventoryRecordDB.store_id).subquery()
        
        records = db.query(InventoryRecordDB).join(
            subq,
            (InventoryRecordDB.store_id == subq.c.store_id) &
            (InventoryRecordDB.date == subq.c.max_date)
        ).filter(InventoryRecordDB.sku_id == sku_id).all()
        
        candidates = []
        for r in records:
            surplus = r.inventory_level - r.reorder_level
            if surplus > needed_qty:
                candidates.append({
                    "store_id": r.store_id,
                    "surplus": surplus,
                    "available_qty": r.inventory_level
                })
        # Sort by most surplus
        candidates.sort(key=lambda x: x["surplus"], reverse=True)
        return candidates

def db_recalculate_po_costs(affected_skus: list[str], price_delta_pct: float) -> list[dict]:
    # Find pending_approval or auto_approved POs referencing affected_skus, recompute total_cost, check budget
    updated_pos = []
    with SessionLocal() as db:
        pos = db.query(PurchaseOrderDB).filter(PurchaseOrderDB.status.in_(["pending_approval", "auto_approved"])).all()
        for po in pos:
            items = po.items
            changed = False
            new_subtotal = 0.0
            
            for item in items:
                if item.get("sku_id") in affected_skus:
                    item["unit_price"] = item["unit_price"] * (1.0 + price_delta_pct / 100.0)
                    changed = True
                new_subtotal += item["unit_price"] * item["quantity"]
                
            if changed:
                po.items = items
                # Recompute total
                old_total = po.total_cost
                new_tax_amount = new_subtotal * 0.18
                new_total = new_subtotal + new_tax_amount
                
                po.total_cost = new_total
                
                # We need to get budget to see if it exceeds. The PO doesn't store project_id directly, 
                # but we can look up project_id by checking budget table? Actually, we'd need to just use site_id if it's there.
                # In agent_tools, it uses project_id or site_id. 
                # For simplicity, we just pass back the PO details so the caller can handle it, or handle it here if budget is globally easy.
                # We'll just return the POs that changed.
                
                updated_pos.append({
                    "po_id": po.po_id,
                    "old_total": old_total,
                    "new_total": new_total,
                    "status": po.status,
                    "reasoning": po.reasoning
                })
                # Commit updates to items and total_cost temporarily
                # The caller will handle the budget check and status update.
        db.commit()
    return updated_pos

def db_update_po_status_and_reason(po_id: str, new_status: str, appended_reason: str):
    with SessionLocal() as db:
        po = db.query(PurchaseOrderDB).filter(PurchaseOrderDB.po_id == po_id).first()
        if po:
            po.status = new_status
            if appended_reason not in po.reasoning:
                po.reasoning = po.reasoning + appended_reason
            db.commit()

# =========================================================
# (End of new functions)
