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


import json
import joblib
import pandas as pd
from datetime import date, timedelta
import os
import numpy as np
import xgboost as xgb

# ---------------------------------------------------------------------------
# Model loader — exclusively uses models/ folder (new 20-product schema).
# ---------------------------------------------------------------------------
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_MODELS_DIR = os.path.join(_BASE_DIR, "models")
_XGB_MODEL_JSON    = os.path.join(_MODELS_DIR, "xgboost_model.json")
_XGB_ENCODERS_PKL  = os.path.join(_MODELS_DIR, "xgboost_encoders.pkl")
_XGB_FEATURE_COLS  = os.path.join(_MODELS_DIR, "xgboost_feature_cols.json")
_ENRICHED_CSV      = os.path.join(_BASE_DIR, "retail_store_inventory_enriched.csv")

# Model artefacts (populated by _load_new_model)
_xgb_booster:      xgb.Booster | None = None
_xgb_encoders:     dict | None = None
_xgb_feature_cols: list[str] | None = None

def _load_new_model() -> bool:
    """Load the XGBoost model from models/. Returns True on success."""
    global _xgb_booster, _xgb_encoders, _xgb_feature_cols
    try:
        if not os.path.exists(_XGB_MODEL_JSON):
            logger.error(
                "models/xgboost_model.json not found at %s — predictions will use heuristic fallback.",
                _XGB_MODEL_JSON,
            )
            return False
        booster = xgb.Booster()
        booster.load_model(_XGB_MODEL_JSON)
        _xgb_booster = booster

        with open(_XGB_FEATURE_COLS, "r") as fh:
            _xgb_feature_cols = json.load(fh)

        _xgb_encoders = joblib.load(_XGB_ENCODERS_PKL)
        logger.info(
            "Loaded XGBoost from models/ (%d features, encoders: %s)",
            len(_xgb_feature_cols),
            list(_xgb_encoders.keys()),
        )
        return True
    except Exception as exc:
        logger.warning("Could not load model from models/: %s", exc)
        return False


_new_model_loaded = _load_new_model()

# No legacy fallback — models/ is the single source of truth.
_xgboost_model = None  # kept so the legacy code path in get_forecast() is never reached

# ---------------------------------------------------------------------------
# Helper: encode a single string value with the pre-trained LabelEncoder
# ---------------------------------------------------------------------------

def _safe_encode(encoders: dict, column: str, value) -> int:
    """
    Encode *value* for *column* using the pre-trained LabelEncoder.
    Returns 0 if the column/value is unseen (avoids KeyError at inference time).
    """
    le = encoders.get(column)
    if le is None:
        return 0
    try:
        return int(le.transform([str(value)])[0])
    except ValueError:
        # Unseen label → return the median class (0) to avoid crashing
        return 0


def get_forecast(sku_id: str, horizon_days: int = 30) -> dict:
    """
    Return demand forecast for a SKU over the given horizon.

    Priority:
      1. New-schema XGBoost (models/xgboost_model.json) trained on the
         20-product, 5-store enriched dataset — uses real column features.
      2. Legacy XGBoost (root model.pkl) trained on synthetic demand_sample.csv
         with one-hot SKU encoding — kept for backward compatibility.
      3. Hard-coded heuristic fallback.
    """

    # ------------------------------------------------------------------
    # 1. New-schema XGBoost (models/ folder)
    # ------------------------------------------------------------------
    if _xgb_booster is not None and _xgb_feature_cols is not None and _xgb_encoders is not None:
        try:
            # Determine Store ID and Product ID from sku_id if possible.
            # sku_id is expected in the format "S001__P0001" (used by the new
            # schema) OR as a legacy "SKU-001" string (tolerated gracefully).
            if "__" in sku_id:
                store_id, product_id = sku_id.split("__", 1)
            else:
                # Legacy SKU: guess store=S001, product=P0001 as a best-effort
                store_id   = "S001"
                product_id = "P0001"

            # Try to grab real context from the enriched CSV so derived
            # features (lags, rolling stats, price, etc.) are realistic.
            row_ctx: dict = {}
            if os.path.exists(_ENRICHED_CSV):
                try:
                    df_ref = pd.read_csv(_ENRICHED_CSV, nrows=50_000)
                    mask = (
                        (df_ref["Store ID"] == store_id)
                        & (df_ref["Product ID"] == product_id)
                    )
                    if mask.any():
                        last_row = df_ref[mask].iloc[-1]
                        row_ctx = last_row.to_dict()
                except Exception:
                    pass  # CSV issue → fall through to defaults

            # Build one feature row per horizon day
            future_dates = [date.today() + timedelta(days=i) for i in range(horizon_days)]
            rows = []
            for d in future_dates:
                r: dict[str, float] = {}

                # Calendar features
                r["day_of_week"]    = d.weekday()
                r["day_of_month"]   = d.day
                r["month"]          = d.month
                r["week_of_year"]   = d.isocalendar()[1]
                r["is_weekend"]     = 1 if d.weekday() >= 5 else 0

                # Numerical features sourced from last known row (or defaults)
                r["Inventory Level"]   = float(row_ctx.get("Inventory Level",   200.0))
                r["Units Ordered"]     = float(row_ctx.get("Units Ordered",     50.0))
                r["Price"]             = float(row_ctx.get("Price",             50.0))
                r["Discount"]          = float(row_ctx.get("Discount",          0.0))
                r["Holiday/Promotion"] = float(row_ctx.get("Holiday/Promotion", 0.0))
                r["Competitor Pricing"]= float(row_ctx.get("Competitor Pricing",50.0))
                r["lead_time_days"]    = float(row_ctx.get("lead_time_days",    7.0))
                r["reorder_level"]     = float(row_ctx.get("reorder_level",     50.0))
                r["hours_since_update"]= float(row_ctx.get("hours_since_update",24.0))
                r["mismatch_count"]    = float(row_ctx.get("mismatch_count",    0.0))
                r["last_known_price"]  = float(row_ctx.get("last_known_price", r["Price"]))

                # Lag/rolling features (use last known Units Sold as best estimate)
                units_sold = float(row_ctx.get("Units Sold", 50.0))
                r["lag_1"]        = units_sold
                r["lag_7"]        = units_sold
                r["lag_14"]       = units_sold
                r["roll_mean_7"]  = units_sold
                r["roll_std_7"]   = 10.0
                r["roll_mean_14"] = units_sold
                r["roll_std_14"]  = 12.0

                # Encoded categorical features
                r["Store ID_enc"]          = _safe_encode(_xgb_encoders, "Store ID",         store_id)
                r["Product ID_enc"]        = _safe_encode(_xgb_encoders, "Product ID",       product_id)
                r["Category_enc"]          = _safe_encode(_xgb_encoders, "Category",         row_ctx.get("Category", "Groceries"))
                r["Region_enc"]            = _safe_encode(_xgb_encoders, "Region",            row_ctx.get("Region", "East"))
                r["Weather Condition_enc"] = _safe_encode(_xgb_encoders, "Weather Condition", row_ctx.get("Weather Condition", "Sunny"))
                r["Seasonality_enc"]       = _safe_encode(_xgb_encoders, "Seasonality",       row_ctx.get("Seasonality", "Summer"))
                r["supplier_id_enc"]       = _safe_encode(_xgb_encoders, "supplier_id",       row_ctx.get("supplier_id", "SUP001"))

                rows.append(r)

            X = pd.DataFrame(rows)
            # Align to the exact training column order; fill any gaps with 0
            for col in _xgb_feature_cols:
                if col not in X.columns:
                    X[col] = 0.0
            X = X[_xgb_feature_cols]

            dmatrix = xgb.DMatrix(X)
            preds   = _xgb_booster.predict(dmatrix)
            preds   = np.clip(preds, 0, None)  # demand can't be negative
            total_predicted_demand = int(np.sum(preds))

            result = ForecastResult(
                sku_id=sku_id,
                horizon_days=int(horizon_days),
                predicted_demand=total_predicted_demand,
                confidence_low=int(total_predicted_demand * 0.85),
                confidence_high=int(total_predicted_demand * 1.15),
            )
            logger.info(
                "[new-schema XGBoost] %s → %d units over %d days",
                sku_id, total_predicted_demand, horizon_days,
            )
            return result.model_dump(mode="json")
        except Exception as exc:
            logger.error("New-schema XGBoost prediction failed: %s", exc)

    # ------------------------------------------------------------------
    # 2. Legacy model.pkl fallback (old synthetic-data schema)
    # ------------------------------------------------------------------
    if _xgboost_model is not None and os.path.exists("demand_sample.csv"):
        try:
            df = pd.read_csv("demand_sample.csv")
            sku_data = df[df['sku_id'] == sku_id]
            last_price = float(sku_data['price'].iloc[-1]) if not sku_data.empty else 150.0

            future_dates = [date.today() + timedelta(days=i) for i in range(horizon_days)]
            features = pd.DataFrame({'date': future_dates})
            features['date'] = pd.to_datetime(features['date'])
            features['price']      = last_price
            features['promotion']  = 0
            features['year']       = features['date'].dt.year
            features['month']      = features['date'].dt.month
            features['day']        = features['date'].dt.day
            features['dayofweek']  = features['date'].dt.dayofweek

            try:
                expected_features = list(_xgboost_model.feature_names_in_)
            except AttributeError:
                expected_features = ['price', 'promotion', 'year', 'month', 'day', 'dayofweek']

            for col in expected_features:
                if col.startswith('sku_id_'):
                    expected_sku = col.replace('sku_id_', '')
                    features[col] = 1 if expected_sku == sku_id else 0
            for col in expected_features:
                if col not in features.columns:
                    features[col] = 0
            X = features[expected_features]

            preds = _xgboost_model.predict(X)
            total_predicted_demand = int(np.sum(preds))
            result = ForecastResult(
                sku_id=sku_id,
                horizon_days=int(horizon_days),
                predicted_demand=total_predicted_demand,
                confidence_low=int(total_predicted_demand * 0.85),
                confidence_high=int(total_predicted_demand * 1.15),
            )
            logger.info("[legacy model.pkl] %s → %d units", sku_id, total_predicted_demand)
            return result.model_dump(mode="json")
        except Exception as exc:
            logger.error("Legacy XGBoost prediction failed: %s", exc)

    # ------------------------------------------------------------------
    # 3. Hard-coded heuristic (last resort)
    # ------------------------------------------------------------------
    base = 300 if sku_id == "SKU-001" else (150 if sku_id == "SKU-002" else 120)
    result = ForecastResult(
        sku_id=sku_id,
        horizon_days=int(horizon_days),
        predicted_demand=base,
        confidence_low=int(base * 0.85),
        confidence_high=int(base * 1.15),
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
        description="Get the demand forecast for a SKU over the next N days.",
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
