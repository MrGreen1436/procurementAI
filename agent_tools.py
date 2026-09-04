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

_xgb_demand = None
_lgbm_demand = None
_xgb_inventory = None
_model_config = {}

try:
    cfg_path = os.path.join(_SAVED_MODELS_DIR, "config.json")
    if os.path.exists(cfg_path):
        import json
        with open(cfg_path, "r") as f:
            _model_config = json.load(f)
        logger.info("Loaded config.json from %s", cfg_path)
except Exception as e:
    logger.warning("Could not load config.json: %s", e)

try:
    xgb_d_path = os.path.join(_SAVED_MODELS_DIR, "xgb_demand.pkl")
    if not os.path.exists(xgb_d_path):
        xgb_d_path = os.path.join(_SAVED_MODELS_DIR, "xgboost_model.pkl")
    if os.path.exists(xgb_d_path):
        _xgb_demand = joblib.load(xgb_d_path)
        logger.info("Loaded new XGBoost Demand model from %s.", xgb_d_path)
except Exception as e:
    logger.warning("Could not load saved_models/xgb_demand.pkl: %s", e)

try:
    lgbm_txt_path = os.path.join(_SAVED_MODELS_DIR, "lgbm_demand.txt")
    if os.path.exists(lgbm_txt_path):
        import lightgbm
        _lgbm_demand = lightgbm.Booster(model_file=lgbm_txt_path)
        logger.info("Loaded new LightGBM Demand model from %s.", lgbm_txt_path)
except Exception as e:
    logger.warning("Could not load saved_models/lgbm_demand.txt: %s", e)

try:
    xgb_inv_path = os.path.join(_SAVED_MODELS_DIR, "xgb_inventory.pkl")
    if os.path.exists(xgb_inv_path):
        _xgb_inventory = joblib.load(xgb_inv_path)
        logger.info("Loaded new XGBoost Inventory model from %s.", xgb_inv_path)
except Exception as e:
    logger.warning("Could not load saved_models/xgb_inventory.pkl: %s", e)


def get_model_daily_predictions(sku_id: str, horizon_days: int = 30) -> Optional[np.ndarray]:
    """Get high-precision daily demand forecast for a SKU using the new trained models."""
    clean_sku = sku_id.upper().strip()
    
    # 1. Look up recent baseline demand from database or mock inventory
    base_demand = 135.0  # single store base default
    store_count = 5
    try:
        from database import db_get_sku_demand_history
        hist = db_get_sku_demand_history(clean_sku)
        if hist:
            recent_demands = [float(r.get("demand", 0)) for r in hist if r.get("demand") is not None]
            if recent_demands:
                chain_mean = float(np.mean(recent_demands))
                if chain_mean > 250:
                    base_demand = chain_mean / float(store_count)
                else:
                    base_demand = max(10.0, chain_mean)
    except Exception as e:
        logger.debug("History lookup for %s: %s", clean_sku, e)

    inv_item = MOCK_INVENTORY.get(clean_sku)
    price = 50.0
    if inv_item and hasattr(inv_item, "unit_price"):
        price = float(inv_item.unit_price)

    # 2. Build feature matrix for future horizon matching config.json demand_features
    demand_features = _model_config.get("demand_features", [])
    today = date.today()
    
    if (_xgb_demand is not None or _lgbm_demand is not None) and demand_features:
        try:
            feature_rows = []
            # Day-of-week retail seasonality factors based on enriched retail data
            dow_factors = {0: 0.96, 1: 0.99, 2: 0.95, 3: 1.03, 4: 1.08, 5: 0.89, 6: 0.98}
            
            for i in range(horizon_days):
                d = today + timedelta(days=i)
                dow = d.weekday()
                dom = d.day
                woy = d.isocalendar()[1]
                m = d.month
                q = (m - 1) // 3 + 1
                y = d.year
                is_wknd = 1 if dow in (5, 6) else 0

                row = {
                    "Units Ordered": float(base_demand * 0.5),
                    "Demand Forecast": float(base_demand),
                    "Price": float(price),
                    "Discount": 10.0,
                    "Holiday/Promotion": 0,
                    "Competitor Pricing": float(price * 0.96),
                    "lead_time_days": 5.0,
                    "reorder_level": float(base_demand * 1.5),
                    "hours_since_update": 12.0,
                    "day_of_week": dow,
                    "day_of_month": dom,
                    "week_of_year": woy,
                    "month": m,
                    "quarter": q,
                    "year": y,
                    "is_weekend": is_wknd,
                    "sin_dow": float(np.sin(2 * np.pi * dow / 7.0)),
                    "cos_dow": float(np.cos(2 * np.pi * dow / 7.0)),
                    "sin_month": float(np.sin(2 * np.pi * m / 12.0)),
                    "cos_month": float(np.cos(2 * np.pi * m / 12.0)),
                    "sin_woy": float(np.sin(2 * np.pi * woy / 52.0)),
                    "cos_woy": float(np.cos(2 * np.pi * woy / 52.0)),
                    "demand_lag_1": float(base_demand),
                    "demand_lag_3": float(base_demand),
                    "demand_lag_7": float(base_demand),
                    "demand_lag_14": float(base_demand),
                    "demand_lag_21": float(base_demand),
                    "demand_lag_28": float(base_demand),
                    "demand_rollmean_3": float(base_demand),
                    "demand_rollstd_3": 5.0,
                    "demand_rollmax_3": float(base_demand + 10),
                    "demand_rollmean_7": float(base_demand),
                    "demand_rollstd_7": 6.0,
                    "demand_rollmax_7": float(base_demand + 15),
                    "demand_rollmean_14": float(base_demand),
                    "demand_rollstd_14": 7.0,
                    "demand_rollmax_14": float(base_demand + 20),
                    "demand_rollmean_28": float(base_demand),
                    "demand_rollstd_28": 8.0,
                    "demand_rollmax_28": float(base_demand + 25),
                    "demand_ewm7": float(base_demand),
                    "demand_ewm14": float(base_demand),
                    "orders_lag1": float(base_demand * 0.5),
                    "demand_trend": 0.0,
                    "price_discount_ratio": float(price / 11.0),
                    "competitor_gap": float(price * 0.04),
                    "discount_flag": 1,
                    "Category_enc": 1,
                    "Region_enc": 1,
                    "Weather Condition_enc": 1,
                    "Seasonality_enc": 1,
                    "supplier_id_enc": 1,
                    "supplier_name_enc": 1,
                }
                feature_rows.append([row.get(col, 0.0) for col in demand_features])

            X = np.array(feature_rows, dtype=np.float32)
            preds_list = []
            if _xgb_demand is not None:
                try:
                    preds_list.append(np.array(_xgb_demand.predict(X), dtype=float))
                except Exception as ex:
                    logger.debug("XGB predict error: %s", ex)
            if _lgbm_demand is not None:
                try:
                    preds_list.append(np.array(_lgbm_demand.predict(X), dtype=float))
                except Exception as el:
                    logger.debug("LGBM predict error: %s", el)

            if preds_list:
                raw_pred = np.mean(preds_list, axis=0)
                for i in range(len(raw_pred)):
                    d_obj = today + timedelta(days=i)
                    raw_pred[i] = raw_pred[i] * dow_factors.get(d_obj.weekday(), 1.0)
                chain_pred = raw_pred * store_count
                return np.clip(chain_pred, 1.0, None)
        except Exception as e:
            logger.warning("New model prediction exception for %s: %s", sku_id, e)

    base_chain = base_demand * store_count
    return np.array([max(1.0, base_chain * (0.95 + 0.1 * np.sin(i / 2.0))) for i in range(horizon_days)])


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
