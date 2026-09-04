"""
agent_tools.py — LLM-callable tool functions + Gemini function-calling schemas.

Uses the NEW google-genai SDK (google.genai) — not the deprecated google-generativeai.

HOW IT WORKS:
  1. Python functions (get_inventory, get_forecast, etc.) read/write store.py.
  2. TOOL_DECLARATIONS is a list of genai.types.FunctionDeclaration objects
     describing each tool to the Gemini model.
  3. dispatch_tool() maps the string name from Gemini → Python function.
"""

import uuid
import logging
from datetime import date
from typing import Any

from google import genai
from google.genai import types as genai_types

from models import (
    InventoryItem, ForecastResult, Supplier, RiskAlert,
    PurchaseOrder, POLineItem,
)
from store import MOCK_INVENTORY, MOCK_SUPPLIERS, MOCK_POS, RISK_ALERTS

logger = logging.getLogger(__name__)
# Tool implementation functions
def get_inventory(sku_id: str) -> dict:
    """Return current inventory for a SKU."""
    item = MOCK_INVENTORY.get(sku_id)
    if not item:
        return {"error": f"No inventory record for SKU '{sku_id}'"}
    return item.model_dump(mode="json")


import joblib
import pandas as pd
from datetime import date, timedelta
import os
import numpy as np
from typing import Optional

# ---------------------------------------------------------------
# Load Newly Trained Models from saved_models/
# ---------------------------------------------------------------
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_SAVED_MODELS_DIR = os.path.join(_BASE_DIR, "saved_models")

_ets_models = {}
_label_encoders = {}
_xgboost_model = None

try:
    ets_path = os.path.join(_SAVED_MODELS_DIR, "ets_models.pkl")
    if os.path.exists(ets_path):
        _ets_models = joblib.load(ets_path)
        logger.info("Loaded new ETS models from %s (%d models).", ets_path, len(_ets_models))
except Exception as e:
    logger.warning("Could not load saved_models/ets_models.pkl: %s", e)

try:
    encoders_path = os.path.join(_SAVED_MODELS_DIR, "label_encoders.pkl")
    if os.path.exists(encoders_path):
        _label_encoders = joblib.load(encoders_path)
        logger.info("Loaded label encoders from %s.", encoders_path)
except Exception as e:
    logger.warning("Could not load saved_models/label_encoders.pkl: %s", e)

try:
    xgb_path = os.path.join(_SAVED_MODELS_DIR, "xgboost_model.pkl")
    if os.path.exists(xgb_path):
        _xgboost_model = joblib.load(xgb_path)
        logger.info("Loaded new XGBoost model from %s.", xgb_path)
except Exception as e:
    logger.warning("Could not load saved_models/xgboost_model.pkl: %s", e)


def get_model_daily_predictions(sku_id: str, horizon_days: int = 30) -> Optional[np.ndarray]:
    """Get high-precision daily demand forecast for a SKU using the new models."""
    clean_sku = sku_id.upper().strip()
    prod_enc = _label_encoders.get("Product ID")

    if _ets_models and prod_enc:
        try:
            classes = list(prod_enc.classes_)
            target_c = None
            if clean_sku in classes:
                target_c = clean_sku
            else:
                for c in classes:
                    if clean_sku in c or c in clean_sku:
                        target_c = c
                        break
            if target_c and target_c in classes:
                p_idx = classes.index(target_c)
                matching = [k for k in _ets_models.keys() if k.endswith(f"_{p_idx}")]
                if matching:
                    preds_list = []
                    for k in matching:
                        m = _ets_models[k]
                        preds_list.append(np.clip(np.array(m.forecast(horizon_days), dtype=float), 0, None))
                    if preds_list:
                        return np.mean(preds_list, axis=0)
        except Exception as e:
            logger.debug("ETS forecast exception: %s", e)
    return None


def get_forecast(sku_id: str, horizon_days: int = 30) -> dict:
    """Return demand forecast for a SKU over the given horizon, using the new models first."""
    future_dates = [date.today() + timedelta(days=i) for i in range(horizon_days)]

    # 1. Primary: Use new trained models from saved_models
    model_preds = get_model_daily_predictions(sku_id, horizon_days)
    if model_preds is not None and len(model_preds) >= horizon_days:
        daily_preds = model_preds[:horizon_days]
        total_predicted_demand = max(1, int(np.sum(daily_preds)))

        # Predict upcoming shortage against current inventory
        shortage_date = None
        shortage_amount = 0
        inv_item = MOCK_INVENTORY.get(sku_id)
        if inv_item:
            current_stock = inv_item.current_stock
            for i, daily_pred in enumerate(daily_preds):
                current_stock -= daily_pred
                if current_stock < 0 and shortage_date is None:
                    shortage_date = future_dates[i]
            if current_stock < 0:
                shortage_amount = int(abs(current_stock))

        result = ForecastResult(
            sku_id=sku_id,
            horizon_days=int(horizon_days),
            predicted_demand=total_predicted_demand,
            confidence_low=int(total_predicted_demand * 0.85),
            confidence_high=int(total_predicted_demand * 1.15),
            projected_shortage_date=shortage_date,
            projected_shortage_amount=shortage_amount,
        )
        return result.model_dump(mode="json")

    # 2. Secondary: Fallback to database demand history
    history_records = []
    try:
        from database import db_get_sku_demand_history
        history_records = db_get_sku_demand_history(sku_id)
    except Exception as dbe:
        logger.debug("Database demand history fetch: %s", dbe)

    inv_item = MOCK_INVENTORY.get(sku_id)
    if history_records:
        avg_d = sum(r["demand"] for r in history_records) / len(history_records)
        base = max(10, int(avg_d * horizon_days))
    elif inv_item:
        base = max(10, int(inv_item.reorder_point * (horizon_days / 14.0)))
    else:
        base = 120

    shortage_date = None
    shortage_amount = 0
    if inv_item:
        current_stock = inv_item.current_stock
        daily_demand = base / max(1, horizon_days)
        if current_stock < base:
            days_until_shortage = int(current_stock / daily_demand) if daily_demand > 0 else 5
            shortage_date = date.today() + timedelta(days=days_until_shortage)
            shortage_amount = int(base - current_stock)

    result = ForecastResult(
        sku_id=sku_id,
        horizon_days=int(horizon_days),
        predicted_demand=base,
        confidence_low=int(base * 0.85),
        confidence_high=int(base * 1.15),
        projected_shortage_date=shortage_date,
        projected_shortage_amount=shortage_amount,
    )
    return result.model_dump(mode="json")



def get_suppliers(sku_id: str) -> dict:
    """Return all suppliers available for a SKU."""
    suppliers = MOCK_SUPPLIERS.get(sku_id, [])
    if not suppliers:
        return {"suppliers": [], "message": f"No suppliers found for SKU '{sku_id}'"}
    return {"suppliers": [s.model_dump(mode="json") for s in suppliers]}


def get_supplier_performance(supplier_id: str) -> dict:
    """Return performance data for a specific supplier."""
    for suppliers in MOCK_SUPPLIERS.values():
        for s in suppliers:
            if s.supplier_id == supplier_id:
                return s.model_dump(mode="json")
    return {"error": f"Unknown supplier '{supplier_id}'"}


def get_risk_alerts(risk_level: str = None) -> dict:
    """Return current risk alerts, optionally filtered by risk_level."""
    alerts = RISK_ALERTS
    if risk_level:
        alerts = [a for a in alerts if a.risk_level == risk_level]
    return {"alerts": [a.model_dump(mode="json") for a in alerts]}


def create_purchase_order(items: list, supplier_id: str, reasoning: str) -> dict:
    """
    Construct, validate, and store a new Purchase Order.

    Business rule (enforced in Python — NOT left to the LLM):
      total_cost < 5_000  → status = "auto_approved"
      total_cost >= 5_000 → status = "pending_approval"
    """
    try:
        line_items = [POLineItem(**item) for item in items]
    except Exception as exc:
        logger.error("PO line item validation failed: %s", exc)
        return {"error": f"Invalid line items: {exc}"}

    total_cost = sum(i.quantity * i.unit_price for i in line_items)
    status = "auto_approved" if total_cost < 5_000 else "pending_approval"
    po_id = f"PO-{uuid.uuid4().hex[:8].upper()}"

    po = PurchaseOrder(
        po_id=po_id,
        supplier_id=supplier_id,
        items=line_items,
        total_cost=round(total_cost, 2),
        reasoning=reasoning,
        status=status,
        generated_by="llm",
        created_at=date.today(),
    )
    MOCK_POS[po_id] = po
    logger.info(
        "PO created: %s | supplier=%s | total=%.2f | status=%s",
        po_id, supplier_id, total_cost, status,
    )
    return po.model_dump(mode="json")


# Tool dispatcher
_WRITE_TOOLS = {"create_purchase_order"}

TOOL_REGISTRY: dict[str, Any] = {
    "get_inventory":            get_inventory,
    "get_forecast":             get_forecast,
    "get_suppliers":            get_suppliers,
    "get_supplier_performance": get_supplier_performance,
    "get_risk_alerts":          get_risk_alerts,
    "create_purchase_order":    create_purchase_order,
}


def dispatch_tool(name: str, args: dict, read_only: bool = False) -> dict:
    """Execute a tool call and return the result as a plain dict."""
    if read_only and name in _WRITE_TOOLS:
        logger.warning("Blocked write tool in read-only mode: %s", name)
        return {"error": f"Tool '{name}' is not available in query mode."}

    fn = TOOL_REGISTRY.get(name)
    if fn is None:
        logger.warning("Unknown tool called: %s", name)
        return {"error": f"Unknown tool: '{name}'"}

    logger.info("Tool call → %s(%s)", name, args)
    try:
        return fn(**args)
    except Exception as exc:
        logger.error("Tool %s raised: %s", name, exc)
        return {"error": str(exc)}

# Gemini FunctionDeclaration schemas (google-genai style)
_line_item_schema = genai_types.Schema(
    type=genai_types.Type.OBJECT,
    properties={
        "sku_id":     genai_types.Schema(type=genai_types.Type.STRING),
        "quantity":   genai_types.Schema(type=genai_types.Type.INTEGER),
        "unit_price": genai_types.Schema(type=genai_types.Type.NUMBER),
    },
    required=["sku_id", "quantity", "unit_price"],
)

# All tool declarations
ALL_FUNCTION_DECLARATIONS = [
    genai_types.FunctionDeclaration(
        name="get_inventory",
        description="Get current stock level and reorder point for a SKU.",
        parameters=genai_types.Schema(
            type=genai_types.Type.OBJECT,
            properties={"sku_id": genai_types.Schema(type=genai_types.Type.STRING, description="SKU identifier, e.g. SKU-001")},
            required=["sku_id"],
        ),
    ),
    genai_types.FunctionDeclaration(
        name="get_forecast",
        description="Get the demand forecast for a SKU over the next N days. Also returns the projected shortage date and amount if a stockout is expected.",
        parameters=genai_types.Schema(
            type=genai_types.Type.OBJECT,
            properties={
                "sku_id":       genai_types.Schema(type=genai_types.Type.STRING, description="SKU identifier"),
                "horizon_days": genai_types.Schema(type=genai_types.Type.INTEGER, description="Days to forecast. Default 30."),
            },
            required=["sku_id"],
        ),
    ),
    genai_types.FunctionDeclaration(
        name="get_suppliers",
        description="List suppliers for a SKU with price, lead time, and reliability score.",
        parameters=genai_types.Schema(
            type=genai_types.Type.OBJECT,
            properties={"sku_id": genai_types.Schema(type=genai_types.Type.STRING, description="SKU identifier")},
            required=["sku_id"],
        ),
    ),
    genai_types.FunctionDeclaration(
        name="get_supplier_performance",
        description="Get reliability and pricing details for a specific supplier.",
        parameters=genai_types.Schema(
            type=genai_types.Type.OBJECT,
            properties={"supplier_id": genai_types.Schema(type=genai_types.Type.STRING, description="Supplier ID, e.g. SUP-01")},
            required=["supplier_id"],
        ),
    ),
    genai_types.FunctionDeclaration(
        name="get_risk_alerts",
        description="Get procurement risk alerts. Optionally filter by risk_level ('low','medium','high').",
        parameters=genai_types.Schema(
            type=genai_types.Type.OBJECT,
            properties={"risk_level": genai_types.Schema(type=genai_types.Type.STRING, description="Optional: 'low', 'medium', or 'high'")},
            required=[],
        ),
    ),
    genai_types.FunctionDeclaration(
        name="create_purchase_order",
        description=(
            "Create a purchase order after analysing inventory, forecast, and suppliers. "
            "Always include a clear reasoning string explaining WHY you chose this supplier and quantity."
        ),
        parameters=genai_types.Schema(
            type=genai_types.Type.OBJECT,
            properties={
                "items": genai_types.Schema(
                    type=genai_types.Type.ARRAY,
                    description="Line items to order",
                    items=_line_item_schema,
                ),
                "supplier_id": genai_types.Schema(type=genai_types.Type.STRING, description="Chosen supplier ID"),
                "reasoning":   genai_types.Schema(type=genai_types.Type.STRING, description="Explanation of the decision"),
            },
            required=["items", "supplier_id", "reasoning"],
        ),
    ),
]

EMAIL_EXTRACT_DECLARATION = genai_types.FunctionDeclaration(
    name="extract_email_info",
    description="Extract structured delay information from a supplier email.",
    parameters=genai_types.Schema(
        type=genai_types.Type.OBJECT,
        properties={
            "supplier_id": genai_types.Schema(type=genai_types.Type.STRING, description="Supplier ID from the email"),
            "sku_id":      genai_types.Schema(type=genai_types.Type.STRING, description="Affected SKU ID"),
            "delay_days":  genai_types.Schema(type=genai_types.Type.INTEGER, description="Days delayed"),
            "summary":     genai_types.Schema(type=genai_types.Type.STRING, description="One-line summary"),
        },
        required=["summary"],
    ),
)

# Pre-built Tool objects for each endpoint's use case
AGENT_TOOL  = genai_types.Tool(function_declarations=ALL_FUNCTION_DECLARATIONS)
QUERY_TOOL  = genai_types.Tool(function_declarations=ALL_FUNCTION_DECLARATIONS[:-1])  # excludes create_purchase_order
EMAIL_TOOL  = genai_types.Tool(function_declarations=[EMAIL_EXTRACT_DECLARATION])
