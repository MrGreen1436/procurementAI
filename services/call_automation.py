"""
services/call_automation.py — Automatic Voice Call Triggers (FastAPI → Twilio Voice Service).

Integrates the Decision Engine with the Node.js Twilio voice service on port 3001.

Features:
  Trigger 1 (Low Stock, event-driven):
    Fires automatically when the Decision Engine outputs "Proceed with Procurement"
    for a given Store ID + Product ID.

  Trigger 2 (Periodic Staleness, time-driven):
    Daily BackgroundScheduler job checking all supplier+product pairs whose
    price quotes are older than STALENESS_THRESHOLD_DAYS (default 90).

Graceful Degradation:
  - Twilio trial accounts can only place calls to verified phone numbers.
  - Calls to unverified numbers or failed HTTP requests return None cleanly and
    log audit events ("automated_supplier_call_failed" / "periodic_price_refresh_call").
  - The main pipeline NEVER crashes or blocks on voice call failures.
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from apscheduler.schedulers.background import BackgroundScheduler

from database import log_audit_event, get_db_session

logger = logging.getLogger("call_automation")

# Read Twilio voice service port/URL from env, defaulting to port 3001
TWILIO_SERVICE_URL = os.getenv("TWILIO_SERVICE_URL", "http://localhost:3001")

# Staleness threshold for Trigger 2 (configurable via env for demo/testing)
STALENESS_THRESHOLD_DAYS = int(os.getenv("STALENESS_THRESHOLD_DAYS", "90"))

# Optional demo phone override: if set, overrides designated demo supplier phone
DEMO_VERIFIED_PHONE = os.getenv("DEMO_VERIFIED_PHONE", os.getenv("VERIFIED_SUPPLIER_PHONE", "")).strip()


def trigger_supplier_call(supplier_phone: str, supplier_name: str, item_name: str) -> dict | None:
    """
    Calls the existing Node.js /make-call endpoint.
    Returns the call result dict on success (e.g. {"callSid": ..., "status": "queued"}),
    or None on failure.
    """
    # If a demo phone override is set and supplier phone is default or designated, apply it
    effective_phone = DEMO_VERIFIED_PHONE if DEMO_VERIFIED_PHONE and supplier_phone.startswith("+1-800") else supplier_phone

    try:
        logger.info(
            "[Call Automation] Initiating call to '%s' (%s) for item: '%s' via %s",
            supplier_name, effective_phone, item_name, TWILIO_SERVICE_URL,
        )
        response = httpx.post(
            f"{TWILIO_SERVICE_URL}/make-call",
            json={
                "supplierPhoneNumber": effective_phone,
                "supplierName": supplier_name,
                "itemName": item_name,
            },
            timeout=60,
        )
        if response.status_code == 200:
            result = response.json()
            logger.info("[Call Automation] Twilio call succeeded: %s", result)
            return result
        
        logger.warning(
            "[Call Automation] Non-200 from Twilio service: status=%d, body=%s",
            response.status_code, response.text[:200]
        )
        return None
    except Exception as e:
        logger.warning("[Call Automation] Failed to reach Twilio service: %s", e)
        return None


def maybe_trigger_call_for_decision(
    decision: str,
    supplier_id: str,
    supplier_lookup: dict,
    item_name: str,
) -> dict | None:
    """
    Call this immediately after make_procurement_decision() returns.
    supplier_lookup: supplier data structure containing phone/name per supplier_id
    (from the enriched dataset or store).
    """
    if decision != "Proceed with Procurement":
        return None

    supplier = supplier_lookup.get(supplier_id)
    if not supplier:
        logger.warning("[Call Automation] No supplier record found for %s, skipping call", supplier_id)
        return None

    supplier_phone = supplier.get("supplier_phone") or supplier.get("phone", "")
    supplier_name  = supplier.get("supplier_name") or supplier.get("name", f"Supplier {supplier_id}")

    result = trigger_supplier_call(
        supplier_phone=supplier_phone,
        supplier_name=supplier_name,
        item_name=item_name,
    )

    # Tie into the existing Audit Trail (Feature 8) — log that a call was
    # automatically triggered, regardless of whether it succeeded
    log_audit_event(
        action="automated_supplier_call_triggered" if result else "automated_supplier_call_failed",
        actor="Decision Engine",
        target_id=supplier_id,
        details=f"Item: {item_name}, Result: {result if result else 'call failed or unreachable'}",
    )

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Trigger 2: Periodic Staleness (time-driven, runs independent of the alert loop)
# ─────────────────────────────────────────────────────────────────────────────

def is_price_stale(last_checked: Optional[datetime]) -> bool:
    """
    Check if a quote's last_checked timestamp is older than STALENESS_THRESHOLD_DAYS.
    None is treated as stale.
    """
    if last_checked is None:
        return True
    
    if isinstance(last_checked, str):
        try:
            last_checked = datetime.fromisoformat(last_checked.replace("Z", "+00:00"))
        except Exception:
            return True

    if last_checked.tzinfo is None:
        last_checked = last_checked.replace(tzinfo=timezone.utc)
    
    age = datetime.now(timezone.utc) - last_checked
    return age > timedelta(days=STALENESS_THRESHOLD_DAYS)


def run_periodic_price_refresh(all_supplier_items: list[dict], max_calls: int = 5) -> list[dict]:
    """
    all_supplier_items: list of dicts like
        {"item_name": ..., "supplier_id": ..., "supplier_phone": ...,
         "supplier_name": ..., "last_checked": datetime}
    Pull this from your existing enriched dataset / database, grouped by
    supplier_id + Product ID, using the most recent order's date as last_checked.
    
    max_calls: safety throttle so periodic scans don't flood telephony APIs all at once.
    """
    results = []
    calls_attempted = 0

    logger.info(
        "[Periodic Refresh] Scanning %d supplier items for price staleness (threshold=%d days)...",
        len(all_supplier_items), STALENESS_THRESHOLD_DAYS
    )

    for entry in all_supplier_items:
        if is_price_stale(entry.get("last_checked")):
            if calls_attempted >= max_calls:
                logger.info("[Periodic Refresh] Reached batch limit of %d calls for this run.", max_calls)
                break

            calls_attempted += 1
            result = trigger_supplier_call(
                supplier_phone=entry["supplier_phone"],
                supplier_name=entry["supplier_name"],
                item_name=entry["item_name"],
            )
            log_audit_event(
                action="periodic_price_refresh_call",
                actor="system",
                target_id=entry["supplier_id"],
                details=f"Item: {entry['item_name']}, Result: {result if result else 'failed'}",
            )
            results.append({"item_name": entry["item_name"], "supplier_id": entry["supplier_id"], "result": result})

    logger.info("[Periodic Refresh] Completed with %d call attempts.", calls_attempted)
    return results


def setup_periodic_call_scheduler(get_all_supplier_items_fn):
    """
    Starts an APScheduler background job running Trigger 2 every 24 hours.
    """
    scheduler = BackgroundScheduler()

    def job():
        try:
            logger.info("[Periodic Refresh] Running scheduled 24-hour price staleness refresh...")
            items = get_all_supplier_items_fn()
            run_periodic_price_refresh(items)
        except Exception as exc:
            logger.error("[Periodic Refresh] Job failed: %s", exc)

    scheduler.add_job(job, "interval", hours=24, id="periodic_price_refresh")
    scheduler.start()
    logger.info("[Periodic Refresh] BackgroundScheduler started (24h interval).")
    return scheduler


# ─────────────────────────────────────────────────────────────────────────────
# Dataset Query Helpers (Enriched CSV Integration)
# ─────────────────────────────────────────────────────────────────────────────

def get_supplier_lookup_from_dataset(csv_path: str = "retail_store_inventory_enriched.csv") -> dict[str, dict]:
    """
    Returns a dict mapping supplier_id -> {"supplier_id", "supplier_name", "supplier_phone"}.
    """
    import pandas as pd
    try:
        df = pd.read_csv(csv_path)
        lookup = {}
        for _, row in df[["supplier_id", "supplier_name", "supplier_phone"]].drop_duplicates().iterrows():
            sup_id = str(row["supplier_id"])
            phone = str(row["supplier_phone"])
            if DEMO_VERIFIED_PHONE and sup_id == "SUP-002":
                phone = DEMO_VERIFIED_PHONE
            lookup[sup_id] = {
                "supplier_id": sup_id,
                "supplier_name": str(row["supplier_name"]),
                "supplier_phone": phone,
            }
        return lookup
    except Exception as exc:
        logger.warning("Could not build supplier lookup from CSV: %s", exc)
        return {}


def get_all_supplier_items_from_dataset(csv_path: str = "retail_store_inventory_enriched.csv") -> list[dict]:
    """
    Queries enriched dataset for all supplier+Product ID pairs with their most recent Date.
    """
    import pandas as pd
    try:
        df = pd.read_csv(csv_path)
        df["Date"] = pd.to_datetime(df["Date"])
        latest = df.groupby(["supplier_id", "Product ID"]).agg({
            "Date": "max",
            "supplier_name": "first",
            "supplier_phone": "first",
            "Category": "first",
        }).reset_index()

        items = []
        for _, row in latest.iterrows():
            sup_id = str(row["supplier_id"])
            phone = str(row["supplier_phone"])
            if DEMO_VERIFIED_PHONE and sup_id == "SUP-002":
                phone = DEMO_VERIFIED_PHONE
            category = str(row.get("Category", ""))
            prod_id = str(row["Product ID"])
            item_name = f"{category} ({prod_id})" if category else prod_id

            items.append({
                "item_name": item_name,
                "supplier_id": sup_id,
                "supplier_name": str(row["supplier_name"]),
                "supplier_phone": phone,
                "last_checked": row["Date"].to_pydatetime().replace(tzinfo=timezone.utc),
            })
        return items
    except Exception as exc:
        logger.warning("Could not query supplier items from CSV: %s", exc)
        return []
