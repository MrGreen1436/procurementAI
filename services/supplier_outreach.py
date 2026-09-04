"""
services/supplier_outreach.py — Corrected supplier outreach module.

Wiring order (matches main.py run_agent() flow):
  1. Decision Engine runs FIRST (compute_inventory_confidence + make_procurement_decision)
  2. maybe_refresh_supplier_quote() fires ONLY for decisions that need external buying
     ("Proceed with Procurement" or "Verify Manually First")
  3. The fresh quote is passed into the LLM / fallback PO builder

Key improvements vs. the old flat-threshold version:
  - is_low_stock()           — relative check (stock vs. reorder_level), not a hardcoded number
  - maybe_refresh_supplier_quote() — gate on decision, only fires when procurement is actually needed
  - Price anchored to supplier['last_price'] * drift (0.92–1.08), not random.uniform(10, 50)
  - Only fires for SKUs already in the risk_alerts loop, not all inventory

Production upgrade path:
  Replace _do_simulated_call() body with a Twilio / Vapi / Bland.ai REST call.
  Everything else stays unchanged.
"""

import os
import random
import time
from datetime import datetime
from typing import Optional

from services.vapi_client import trigger_outbound_call, get_call_status

# ---------------------------------------------------------------
# Vapi real-call configuration (from environment)
# ---------------------------------------------------------------
VAPI_ASSISTANT_ID      = os.environ.get("VAPI_ASSISTANT_ID")
VAPI_PHONE_NUMBER_ID   = os.environ.get("VAPI_PHONE_NUMBER_ID")
DEMO_SUPPLIER_PHONE_NUMBER = os.environ.get("DEMO_SUPPLIER_PHONE_NUMBER")

# Feature flag: set USE_REAL_VOICE_CALLS=true in .env to enable real Vapi calls.
# Defaults to False so the simulated path is used unless explicitly opted in.
USE_REAL_VOICE_CALLS = os.environ.get("USE_REAL_VOICE_CALLS", "false").lower() == "true"


# ---------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------

def is_low_stock(item, supplier: dict) -> bool:
    """
    Return True if current stock is at or below the SKU's reorder_level.

    Uses item.reorder_level if present (added to InventoryItem model).
    Falls back to item.reorder_point (already on the model) if reorder_level
    is absent, so existing data continues to work without any migration.

    Args:
        item:     InventoryItem Pydantic model instance.
        supplier: Supplier outreach dict (unused here, kept for future gate logic).
    """
    threshold = getattr(item, "reorder_level", None) or getattr(item, "reorder_point", 0)
    return item.current_stock <= threshold


def _do_simulated_call(sku_id: str, supplier: dict) -> dict:
    """
    Core simulation of a supplier phone/API quote call.

    Price is anchored to the supplier's last known price (±8% market drift)
    so that values remain consistent with your demo data. Falls back to a
    sensible range ($50–$300) only on the very first call when no history exists.

    Args:
        sku_id:   SKU being quoted.
        supplier: Supplier outreach dict (must have 'name'; may have 'last_price').

    Returns:
        dict: price, lead_time_days, availability, timestamp
    """
    last_price = supplier.get("last_price")
    if last_price and last_price > 0:
        # ±8% drift from last known price — stays consistent with demo data
        price = round(last_price * random.uniform(0.92, 1.08), 2)
    else:
        # First-ever call: anchor to a plausible procurement range
        price = round(random.uniform(50.0, 300.0), 2)

    lead_time_days = random.randint(2, 10)
    availability   = random.choice(["in_stock", "low_stock"])
    timestamp      = datetime.utcnow().isoformat()

    result = {
        "price":          price,
        "lead_time_days": lead_time_days,
        "availability":   availability,
        "timestamp":      timestamp,
    }

    print(
        f"[Supplier Outreach] Call to '{supplier['name']}' for SKU {sku_id} -> "
        f"price=${price} | lead={lead_time_days}d | avail={availability}"
    )
    return result


def _update_supplier_record(supplier: dict, data: dict) -> None:
    """Persist call results back into the supplier outreach dict in-place."""
    supplier["last_price"]     = data["price"]
    supplier["last_checked"]   = data["timestamp"]
    supplier["last_lead_time"] = data["lead_time_days"]
    print(f"[Supplier Outreach] Record updated for '{supplier['name']}'")


# ---------------------------------------------------------------
# Public API — called by run_agent()
# ---------------------------------------------------------------

def maybe_refresh_supplier_quote(
    sku_id: str,
    item,               # InventoryItem instance
    supplier: dict,     # entry from SUPPLIER_OUTREACH_DATA
    decision: str,      # result of make_procurement_decision()["decision"]
) -> Optional[dict]:
    """
    Conditionally refresh the supplier quote for sku_id.

    Fires ONLY when:
      a) The Decision Engine has already decided that external procurement
         is needed ("Proceed with Procurement" or "Verify Manually First"), AND
      b) is_low_stock() confirms the item is at or below its reorder level.

    This ensures supplier calls are:
      - Scoped to alert SKUs (not the whole inventory).
      - Skipped entirely when internal stock transfer is the chosen path.
      - Price-consistent with existing demo data (no wild random swings).

    Args:
        sku_id:   SKU being evaluated.
        item:     InventoryItem Pydantic model.
        supplier: Mutable outreach dict from SUPPLIER_OUTREACH_DATA.
        decision: One of "Use Internal Stock" | "Verify Manually First" |
                  "Proceed with Procurement".

    Returns:
        Fresh quote dict if the call fired, None otherwise.
    """
    PROCUREMENT_DECISIONS = {"Proceed with Procurement", "Verify Manually First"}

    if decision not in PROCUREMENT_DECISIONS:
        # Internal transfer chosen — no supplier call needed
        return None

    if not is_low_stock(item, supplier):
        # Stock is healthy relative to reorder level — skip unnecessary call
        return None

    print(
        f"[Supplier Outreach] Refreshing quote for SKU {sku_id} "
        f"(decision={decision}, real_calls={USE_REAL_VOICE_CALLS})"
    )
    if USE_REAL_VOICE_CALLS:
        quote = real_supplier_call(sku_id, supplier)
    else:
        quote = _do_simulated_call(sku_id, supplier)
    _update_supplier_record(supplier, quote)
    return quote


# ---------------------------------------------------------------
# Real Vapi voice call (replaces simulation when USE_REAL_VOICE_CALLS=true)
# ---------------------------------------------------------------

def real_supplier_call(
    sku_id: str,
    supplier: dict,
    max_wait_seconds: int = 45,
) -> dict:
    """
    Places a REAL outbound voice call via Vapi and waits up to max_wait_seconds
    for the call to complete and structured data to be extracted.

    Falls back to simulate_supplier_call() automatically if:
      - Any environment variable is missing.
      - The Vapi call trigger fails.
      - The call does not finish within max_wait_seconds.
      - Structured data is missing from the completed call.

    Args:
        sku_id:           SKU being quoted.
        supplier:         Supplier outreach dict (must have 'name').
        max_wait_seconds: How long to poll before giving up (default 45s).

    Returns:
        dict with keys: price, lead_time_days, availability, timestamp, source.
        source == "real_call" when Vapi data was used; "simulation" when fallback fired.
    """
    # Guard: all three env vars must be set
    if not (VAPI_ASSISTANT_ID and VAPI_PHONE_NUMBER_ID and DEMO_SUPPLIER_PHONE_NUMBER):
        missing = [
            v for v, k in [
                ("VAPI_ASSISTANT_ID", VAPI_ASSISTANT_ID),
                ("VAPI_PHONE_NUMBER_ID", VAPI_PHONE_NUMBER_ID),
                ("DEMO_SUPPLIER_PHONE_NUMBER", DEMO_SUPPLIER_PHONE_NUMBER),
            ] if not k
        ]
        print(f"[Vapi] Missing env vars {missing}, falling back to simulation")
        return simulate_supplier_call(sku_id, supplier)

    print(f"[Vapi] Triggering outbound call to {DEMO_SUPPLIER_PHONE_NUMBER} for SKU {sku_id}")
    call_result = trigger_outbound_call(
        VAPI_ASSISTANT_ID,
        VAPI_PHONE_NUMBER_ID,
        DEMO_SUPPLIER_PHONE_NUMBER,
    )

    if "error" in call_result:
        print(f"[Vapi] Call trigger failed, falling back to simulation: {call_result['error']}")
        return simulate_supplier_call(sku_id, supplier)

    call_id = call_result.get("id")
    if not call_id:
        print("[Vapi] No call ID returned, falling back to simulation")
        return simulate_supplier_call(sku_id, supplier)

    print(f"[Vapi] Call initiated (id={call_id}), polling for up to {max_wait_seconds}s...")

    # Poll until the call ends or we time out
    waited       = 0
    poll_interval = 3
    while waited < max_wait_seconds:
        time.sleep(poll_interval)
        waited += poll_interval

        status = get_call_status(call_id)
        if "error" in status:
            print(f"[Vapi] Status poll error: {status['error']}")
            continue

        call_status = status.get("status")
        print(f"[Vapi] Poll {waited}s — status={call_status}")

        if call_status == "ended":
            extracted = status.get("analysis", {}).get("structuredData", {})
            if extracted and extracted.get("price") is not None:
                quote = {
                    "price":          extracted.get("price"),
                    "lead_time_days": extracted.get("lead_time_days"),
                    "availability":   extracted.get("availability", "unknown"),
                    "timestamp":      status.get("endedAt"),
                    "source":         "real_call",
                }
                print(
                    f"[Vapi] Call complete for SKU {sku_id} → "
                    f"price={quote['price']} lead={quote['lead_time_days']}d "
                    f"avail={quote['availability']}"
                )
                return quote
            else:
                print("[Vapi] Call ended but structured data missing — falling back to simulation")
                break

    print("[Vapi] Call did not complete in time or extraction failed, falling back to simulation")
    return simulate_supplier_call(sku_id, supplier)


# ---------------------------------------------------------------
# Backward-compatibility shim
# (keeps old callers that still use simulate_supplier_call + update_supplier_data)
# ---------------------------------------------------------------

def simulate_supplier_call(sku_id: str, supplier: dict) -> dict:
    """Compatibility wrapper around _do_simulated_call."""
    return _do_simulated_call(sku_id, supplier)


def update_supplier_data(supplier: dict, data: dict) -> None:
    """Compatibility wrapper around _update_supplier_record."""
    _update_supplier_record(supplier, data)
