import re
import os
import json
import logging
from database import (
    db_save_market_event,
    db_update_inventory_price,
    db_find_transfer_candidates,
    db_recalculate_po_costs,
    db_update_po_status_and_reason,
    db_log_audit_event,
    db_get_budget,
    db_set_budget
)
from main import broadcast_sync, trigger_supplier_call

logger = logging.getLogger("market_events")

# Regex fallback constants
CATEGORIES = ["steel", "electronics", "lumber", "plastic", "semiconductor", "food", "grocery", "toy"]

def extract_event_details(text: str) -> dict:
    # Check if Gemini is available
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        try:
            from google import genai
            from google.genai import types
            client = genai.Client(api_key=api_key)
            prompt = f"""
            Analyze the following supply chain event text and extract details as JSON:
            Event: "{text}"
            
            Return exactly this JSON schema with no other text:
            {{
                "affected_category": "string or null",
                "affected_sku_id": "string or null (e.g. P0001)",
                "price_delta_pct": float (e.g. 18.0 for 18% surge, -5.0 for drop),
                "lead_time_delta_days": integer (e.g. 14 for 2 weeks delay),
                "severity": "low" | "medium" | "high"
            }}
            Rules for severity: >=20% price or >=14 days delay = high, >=10% or >=7 days = medium, else low.
            """
            
            model_name = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
            resp = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )
            data = json.loads(resp.text)
            return {
                "affected_category": data.get("affected_category"),
                "affected_sku_id": data.get("affected_sku_id"),
                "price_delta_pct": float(data.get("price_delta_pct") or 0.0),
                "lead_time_delta_days": int(data.get("lead_time_delta_days") or 0),
                "severity": data.get("severity", "low").lower()
            }
        except Exception as e:
            logger.warning("Gemini extraction failed, falling back to regex: %s", e)

    # Fallback to regex logic
    text_lower = text.lower()
    cat_match = next((c for c in CATEGORIES if c in text_lower), None)
    
    # Try to find SKU
    sku_match = re.search(r'(p\d{4})', text_lower)
    sku = sku_match.group(1).upper() if sku_match else None
    
    price_delta = 0.0
    delay_days = 0
    
    pct_match = re.search(r'(\d+(?:\.\d+)?)\s*%', text_lower)
    if pct_match and any(w in text_lower for w in ["surge", "spike", "increase", "hike", "jump"]):
        price_delta = float(pct_match.group(1))
    elif pct_match and any(w in text_lower for w in ["drop", "decrease", "fall"]):
        price_delta = -float(pct_match.group(1))
        
    days_match = re.search(r'(\d+)\s*(?:day|week)s?\s*(?:delay|shortage|wait)', text_lower)
    if days_match:
        val = int(days_match.group(1))
        if "week" in text_lower:
            val *= 7
        delay_days = val
        
    # Calculate severity
    severity = "low"
    if abs(price_delta) >= 20 or delay_days >= 14:
        severity = "high"
    elif abs(price_delta) >= 10 or delay_days >= 7:
        severity = "medium"
        
    return {
        "affected_category": cat_match,
        "affected_sku_id": sku,
        "price_delta_pct": price_delta,
        "lead_time_delta_days": delay_days,
        "severity": severity
    }


def trigger_supplier_outreach_for_event(sku: str, reason: str):
    try:
        trigger_supplier_call({"sku_id": sku, "reason": reason})
    except Exception as e:
        logger.warning("Auto supplier outreach failed for SKU %s: %s", sku, e)


def process_market_event(text: str) -> dict:
    details = extract_event_details(text)
    details["event_text"] = text
    
    # 1. Save to DB
    saved_event = db_save_market_event(details)
    
    # 2. Update price in inventory
    affected_skus = db_update_inventory_price(details["affected_sku_id"], details["affected_category"], details["price_delta_pct"])
    
    # Log application
    db_log_audit_event(
        action="MARKET_EVENT_APPLIED",
        entity_type="system",
        entity_id=f"EVENT-{saved_event['id']}",
        actor="Event Center",
        details=saved_event,
        status="info"
    )
    
    payload = {
        "summary": saved_event,
        "affected_skus": affected_skus,
        "affected_pos": [],
        "transfer_suggestions": [],
        "auto_call_triggered": False
    }

    if details["severity"] in ["medium", "high"]:
        # Recalculate PO costs
        updated_pos = db_recalculate_po_costs(affected_skus, details["price_delta_pct"])
        
        for po in updated_pos:
            # Check budget to see if over budget now
            # Budget check logic: we assume a global project_id 'PROJ-1000' or similar if not specified
            # We'll just check if total exceeds 10k or if a budget exists.
            # Simplified: just set to pending_approval and append reasoning.
            new_status = po["status"]
            reason_append = ""
            
            # Since prices went up, we just append reason and set pending.
            if details["price_delta_pct"] > 0:
                new_status = "pending_approval"
                reason_append = " | PRICE ADJUSTED DUE TO EVENT"
                db_update_po_status_and_reason(po["po_id"], new_status, reason_append)
                payload["affected_pos"].append(po["po_id"])
                
                db_log_audit_event(
                    action="PO_PRICE_ADJUSTED",
                    entity_type="purchase_order",
                    entity_id=po["po_id"],
                    actor="Event Center",
                    details={"old": po["old_total"], "new": po["new_total"]},
                    status="warning"
                )

    if details["severity"] == "high":
        # Search for transfers
        for sku in affected_skus:
            # Assume we need 100 qty
            candidates = db_find_transfer_candidates(sku, needed_qty=50)
            if candidates:
                payload["transfer_suggestions"].append({
                    "sku_id": sku,
                    "candidates": candidates
                })
            else:
                # Trigger supplier call
                trigger_supplier_outreach_for_event(sku, "Market event: price/supply disruption — urgent re-quote needed")
                payload["auto_call_triggered"] = True
                
                db_log_audit_event(
                    action="AUTO_CALL_TRIGGERED_BY_EVENT",
                    entity_type="supplier_call",
                    entity_id=sku,
                    actor="Event Center",
                    details={"reason": "No transfer candidates found"},
                    status="warning"
                )
                
    broadcast_sync("MARKET_EVENT_DETECTED", payload)
    return payload
