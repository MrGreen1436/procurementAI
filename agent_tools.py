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

# Load XGBoost model if it exists
try:
    _xgboost_model = joblib.load("model.pkl")
    logger.info("Loaded model.pkl successfully.")
except Exception as e:
    _xgboost_model = None
    logger.warning("Could not load model.pkl, using fallback. Error: %s", e)

def get_forecast(sku_id: str, horizon_days: int = 30) -> dict:
    """Return demand forecast for a SKU over the given horizon."""
    
    # Try using XGBoost model
    if _xgboost_model is not None and os.path.exists("demand_sample.csv"):
        try:
            df = pd.read_csv("demand_sample.csv")
            sku_data = df[df['sku_id'] == sku_id]
            if not sku_data.empty:
                last_price = float(sku_data['price'].iloc[-1])
            else:
                last_price = 150.0
                
            future_dates = [date.today() + timedelta(days=i) for i in range(horizon_days)]
            
            # Construct features
            features = pd.DataFrame({'date': future_dates})
            features['date'] = pd.to_datetime(features['date'])
            features['price'] = last_price
            features['promotion'] = 0
            features['year'] = features['date'].dt.year
            features['month'] = features['date'].dt.month
            features['day'] = features['date'].dt.day
            features['dayofweek'] = features['date'].dt.dayofweek
            
            # Dynamically fetch the expected feature columns
            try:
                expected_features = list(_xgboost_model.feature_names_in_)
            except AttributeError:
                expected_features = ['price', 'promotion', 'year', 'month', 'day', 'dayofweek'] # Fallback
                
            # Add dynamic SKU one-hot encoding based on what the model expects
            for col in expected_features:
                if col.startswith('sku_id_'):
                    expected_sku = col.replace('sku_id_', '')
                    features[col] = 1 if expected_sku == sku_id else 0
                    
            # Ensure X exactly matches expected columns
            for col in expected_features:
                if col not in features.columns:
                    features[col] = 0
            X = features[expected_features]
            
            # Predict
            preds = _xgboost_model.predict(X)
            total_predicted_demand = int(np.sum(preds))
            
            result = ForecastResult(
                sku_id=sku_id,
                horizon_days=int(horizon_days),
                predicted_demand=total_predicted_demand,
                confidence_low=int(total_predicted_demand * 0.85),
                confidence_high=int(total_predicted_demand * 1.15),
            )
            return result.model_dump(mode="json")
        except Exception as e:
            logger.error("XGBoost prediction failed: %s", e)
            
    # Fallback if XGBoost fails or not found
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
