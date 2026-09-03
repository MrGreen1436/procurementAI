"""
agent_tools.py — Tool functions and Gemini function declarations for Procurement Agent.
Provides inventory, forecast, supplier lookups, PO creation, and email parsing.
"""

import os
import uuid
import logging
from datetime import date, datetime
import pandas as pd
import numpy as np

logger = logging.getLogger("agent_tools")

# Try importing google.genai types
try:
    from google.genai import types as genai_types
except ImportError:
    genai_types = None

from store import MOCK_INVENTORY, MOCK_SUPPLIERS, MOCK_POS, RISK_ALERTS
from models import PurchaseOrder, POLineItem, RiskAlert, InventoryItem, Supplier

# XGBoost model cache
_xgboost_model = None
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_MODEL_PATH = os.path.join(_BASE_DIR, "model.pkl")

def _load_model():
    global _xgboost_model
    if _xgboost_model is None and os.path.exists(_MODEL_PATH):
        try:
            import joblib
            _xgboost_model = joblib.load(_MODEL_PATH)
            logger.info("Loaded XGBoost model from %s", _MODEL_PATH)
        except Exception as e:
            logger.warning("Could not load XGBoost model: %s", e)
            _xgboost_model = None
    return _xgboost_model

_load_model()


def get_inventory(sku_id: str) -> dict:
    """Return current stock level and reorder point for a given sku_id."""
    inv = MOCK_INVENTORY.get(sku_id)
    if not inv:
        return {"error": f"SKU '{sku_id}' not found in inventory."}
    return {
        "sku_id": inv.sku_id,
        "site_id": inv.site_id,
        "current_stock": inv.current_stock,
        "reorder_point": inv.reorder_point,
    }


def get_forecast(sku_id: str, horizon_days: int = 30) -> dict:
    """Return predicted demand over horizon_days for a given sku_id using ML or historical proxy."""
    model = _load_model()
    csv_path = os.path.join(_BASE_DIR, "demand_sample.csv")
    if os.path.exists(os.path.join(_BASE_DIR, "uploaded_dataset.csv")):
        csv_path = os.path.join(_BASE_DIR, "uploaded_dataset.csv")

    avg_daily_demand = 15.0
    demand_std = 4.0

    if os.path.exists(csv_path):
        try:
            df = pd.read_csv(csv_path)
            sku_df = df[df["sku_id"] == sku_id]
            if not sku_df.empty:
                avg_daily_demand = float(sku_df["demand"].mean())
                demand_std = float(sku_df["demand"].std()) if not np.isnan(sku_df["demand"].std()) else 3.0
        except Exception as e:
            logger.warning("Error reading dataset for forecast: %s", e)

    predicted = int(avg_daily_demand * horizon_days)
    margin = int(1.96 * demand_std * np.sqrt(horizon_days))
    confidence_low = max(0, predicted - margin)
    confidence_high = predicted + margin

    return {
        "sku_id": sku_id,
        "horizon_days": horizon_days,
        "predicted_demand": predicted,
        "confidence_low": confidence_low,
        "confidence_high": confidence_high,
    }


def get_suppliers(sku_id: str) -> list[dict]:
    """Return list of available suppliers for a given SKU with pricing, lead time, and reliability."""
    sups = MOCK_SUPPLIERS.get(sku_id, [])
    if not sups:
        return []
    return [
        {
            "supplier_id": s.supplier_id,
            "name": s.name,
            "unit_price": s.unit_price,
            "lead_time_days": s.lead_time_days,
            "reliability_score": s.reliability_score,
        }
        for s in sups
    ]


def get_supplier_performance(supplier_id: str) -> dict:
    """Return performance metrics for a specific supplier by ID."""
    for sku_sups in MOCK_SUPPLIERS.values():
        for s in sku_sups:
            if s.supplier_id == supplier_id:
                return {
                    "supplier_id": s.supplier_id,
                    "name": s.name,
                    "unit_price": s.unit_price,
                    "lead_time_days": s.lead_time_days,
                    "reliability_score": s.reliability_score,
                }
    return {"error": f"Supplier '{supplier_id}' not found."}


def get_risk_alerts() -> list[dict]:
    """Return active stockout risk alerts."""
    return [
        {
            "alert_id": a.alert_id,
            "sku_id": a.sku_id,
            "site_id": a.site_id,
            "risk_level": a.risk_level,
            "reason": a.reason,
            "predicted_stockout_date": str(a.predicted_stockout_date) if a.predicted_stockout_date else None,
        }
        for a in RISK_ALERTS
    ]


def create_purchase_order(sku_id: str, quantity: int, supplier_id: str, reasoning: str) -> dict:
    """Create a new purchase order to replenish stock for a given SKU."""
    quantity = int(quantity)
    # Find supplier price
    unit_price = 100.0
    for sups in MOCK_SUPPLIERS.values():
        for s in sups:
            if s.supplier_id == supplier_id:
                unit_price = s.unit_price
                break

    total_cost = round(quantity * unit_price, 2)
    po_id = f"PO-{uuid.uuid4().hex[:8].upper()}"
    status = "auto_approved" if total_cost < 5000 else "pending_approval"

    po = PurchaseOrder(
        po_id=po_id,
        supplier_id=supplier_id,
        items=[POLineItem(sku_id=sku_id, quantity=quantity, unit_price=unit_price)],
        total_cost=total_cost,
        reasoning=reasoning,
        status=status,
        generated_by="llm",
        created_at=date.today(),
    )
    MOCK_POS[po_id] = po
    logger.info("Created PO %s via agent tool: $%.2f (%s)", po_id, total_cost, status)

    return {
        "po_id": po.po_id,
        "supplier_id": po.supplier_id,
        "total_cost": po.total_cost,
        "status": po.status,
        "reasoning": po.reasoning,
    }


def extract_email_info(
    supplier_id: str = None,
    sku_id: str = None,
    delay_days: int = None,
    summary: str = "",
) -> dict:
    """Structured output extractor for supplier delay emails."""
    return {
        "supplier_id": supplier_id,
        "sku_id": sku_id,
        "delay_days": delay_days,
        "summary": summary,
    }


def dispatch_tool(tool_name: str, tool_args: dict, read_only: bool = False) -> dict:
    """Route tool calls from LLM to Python functions."""
    if read_only and tool_name == "create_purchase_order":
        return {"error": "create_purchase_order is blocked in read-only query mode."}

    handlers = {
        "get_inventory": lambda: get_inventory(tool_args.get("sku_id", "")),
        "get_forecast": lambda: get_forecast(tool_args.get("sku_id", ""), int(tool_args.get("horizon_days", 30))),
        "get_suppliers": lambda: get_suppliers(tool_args.get("sku_id", "")),
        "get_supplier_performance": lambda: get_supplier_performance(tool_args.get("supplier_id", "")),
        "get_risk_alerts": lambda: get_risk_alerts(),
        "create_purchase_order": lambda: create_purchase_order(
            sku_id=tool_args.get("sku_id", ""),
            quantity=int(tool_args.get("quantity", 0)),
            supplier_id=tool_args.get("supplier_id", ""),
            reasoning=tool_args.get("reasoning", "Agent initiated order."),
        ),
        "extract_email_info": lambda: extract_email_info(
            supplier_id=tool_args.get("supplier_id"),
            sku_id=tool_args.get("sku_id"),
            delay_days=int(tool_args.get("delay_days")) if tool_args.get("delay_days") is not None else None,
            summary=tool_args.get("summary", ""),
        ),
    }

    handler = handlers.get(tool_name)
    if not handler:
        return {"error": f"Unknown tool: {tool_name}"}

    try:
        return handler()
    except Exception as e:
        logger.error("Error executing tool %s: %s", tool_name, e)
        return {"error": str(e)}


# ---------------------------------------------------------------
# Gemini Tool Declarations
# ---------------------------------------------------------------

def _build_tools():
    if genai_types is None:
        return None, None, None

    agent_declarations = [
        genai_types.FunctionDeclaration(
            name="get_inventory",
            description="Get current stock and reorder point for a given SKU.",
            parameters=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                properties={"sku_id": genai_types.Schema(type=genai_types.Type.STRING, description="The SKU identifier")},
                required=["sku_id"],
            ),
        ),
        genai_types.FunctionDeclaration(
            name="get_forecast",
            description="Get forecasted demand and confidence bounds for a SKU over a horizon of days.",
            parameters=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                properties={
                    "sku_id": genai_types.Schema(type=genai_types.Type.STRING, description="The SKU identifier"),
                    "horizon_days": genai_types.Schema(type=genai_types.Type.INTEGER, description="Forecast horizon in days (default 30)"),
                },
                required=["sku_id"],
            ),
        ),
        genai_types.FunctionDeclaration(
            name="get_suppliers",
            description="List available suppliers for a given SKU with pricing, lead time, and reliability.",
            parameters=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                properties={"sku_id": genai_types.Schema(type=genai_types.Type.STRING, description="The SKU identifier")},
                required=["sku_id"],
            ),
        ),
        genai_types.FunctionDeclaration(
            name="get_supplier_performance",
            description="Get performance metrics and reliability history for a specific supplier.",
            parameters=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                properties={"supplier_id": genai_types.Schema(type=genai_types.Type.STRING, description="Supplier identifier")},
                required=["supplier_id"],
            ),
        ),
        genai_types.FunctionDeclaration(
            name="get_risk_alerts",
            description="Retrieve active stockout risk alerts across all SKUs.",
            parameters=genai_types.Schema(type=genai_types.Type.OBJECT, properties={}),
        ),
        genai_types.FunctionDeclaration(
            name="create_purchase_order",
            description="Create a purchase order to replenish stock. Orders < $5,000 are auto-approved; >= $5,000 require human review.",
            parameters=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                properties={
                    "sku_id": genai_types.Schema(type=genai_types.Type.STRING, description="The SKU to order"),
                    "quantity": genai_types.Schema(type=genai_types.Type.INTEGER, description="Units to order"),
                    "supplier_id": genai_types.Schema(type=genai_types.Type.STRING, description="Selected supplier ID"),
                    "reasoning": genai_types.Schema(type=genai_types.Type.STRING, description="Justification explaining supplier and quantity choice"),
                },
                required=["sku_id", "quantity", "supplier_id", "reasoning"],
            ),
        ),
    ]

    query_declarations = [d for d in agent_declarations if d.name != "create_purchase_order"]

    email_declarations = [
        genai_types.FunctionDeclaration(
            name="extract_email_info",
            description="Extract supplier ID, SKU ID, delay in days, and summary from a supplier delay email.",
            parameters=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                properties={
                    "supplier_id": genai_types.Schema(type=genai_types.Type.STRING, description="Supplier ID or company name"),
                    "sku_id": genai_types.Schema(type=genai_types.Type.STRING, description="Affected SKU identifier"),
                    "delay_days": genai_types.Schema(type=genai_types.Type.INTEGER, description="Shipment delay in days"),
                    "summary": genai_types.Schema(type=genai_types.Type.STRING, description="Concise explanation of the delay"),
                },
                required=["summary"],
            ),
        )
    ]

    return (
        genai_types.Tool(function_declarations=agent_declarations),
        genai_types.Tool(function_declarations=query_declarations),
        genai_types.Tool(function_declarations=email_declarations),
    )

AGENT_TOOL, QUERY_TOOL, EMAIL_TOOL = _build_tools()
