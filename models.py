"""
Pydantic models for the AI Procurement Agent backend.
These define the shape of every request/response so the LLM's outputs
can be validated instead of trusted blindly.

Merged from:
  - shashi:    extended InventoryItem (hours_since_update, mismatch_count, reorder_level)
               feedback_applied on PurchaseOrder
  - nanditha2: extended EmailParseResult, ScenarioInput, ScenarioResult, RealtimeEvent
  - main:      projected_shortage_date / projected_shortage_amount on ForecastResult
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal, List
from datetime import date, datetime


class InventoryItem(BaseModel):
    sku_id: str
    site_id: str
    current_stock: int
    reorder_point: int
    # reorder_level: explicit threshold used by supplier outreach is_low_stock().
    # Defaults to 0 so is_low_stock() falls back to reorder_point when unset.
    reorder_level: int = Field(default=0, description="Stock level at which supplier outreach triggers (0 = use reorder_point)")
    # Decision Engine fields — added with safe defaults so existing data still works
    hours_since_update: float = Field(default=12.0, description="Hours since inventory was last verified")
    mismatch_count: int = Field(default=0, description="Number of physical-vs-system stock mismatches")
    in_stock_at_other_site: bool = Field(default=False, description="True if any other site has surplus of this SKU")
    retrieval_minutes: int = Field(default=60, description="Estimated minutes to transfer from nearest surplus site")


class ForecastResult(BaseModel):
    sku_id: str
    horizon_days: int
    predicted_demand: int
    confidence_low: int
    confidence_high: int
    # Shortage prediction (computed by day-by-day stock simulation in agent_tools.py)
    projected_shortage_date: Optional[date] = None
    projected_shortage_amount: int = 0


class Supplier(BaseModel):
    supplier_id: str
    name: str
    unit_price: float
    lead_time_days: int
    reliability_score: float = Field(ge=0, le=1)


class RiskAlert(BaseModel):
    alert_id: str
    sku_id: str
    site_id: str
    risk_level: Literal["low", "medium", "high"]
    reason: str
    predicted_stockout_date: Optional[date] = None


class POLineItem(BaseModel):
    sku_id: str
    quantity: int
    unit_price: float


class PurchaseOrder(BaseModel):
    po_id: str
    supplier_id: str
    items: list[POLineItem]
    total_cost: float
    reasoning: str
    status: Literal["auto_approved", "pending_approval", "rejected"]
    generated_by: Literal["llm", "fallback"] = "llm"
    created_at: date = Field(default_factory=date.today)
    # Idempotent approval guard — never exposed to frontend, internal only
    feedback_applied: bool = Field(default=False, exclude=True)


class AgentRunRequest(BaseModel):
    dry_run: bool = False


class QueryRequest(BaseModel):
    question: str


class QueryResponse(BaseModel):
    answer: str
    tools_used: list[str] = []


class EmailParseRequest(BaseModel):
    raw_email_text: str


class EmailParseResult(BaseModel):
    supplier_id: Optional[str] = None
    sku_id: Optional[str] = None
    delay_days: Optional[int] = None
    summary: str
    # Extended fields from nanditha2
    affected_orders: list[str] = Field(default_factory=list)
    new_lead_time_days: Optional[int] = None
    stockout_risk_triggered: bool = False
    created_alert_id: Optional[str] = None
    # Returned only after the parsed notice has been committed to durable storage.
    persisted_email_id: Optional[int] = None


# ── What-If Simulator (from nanditha2) ────────────────────────────────────────

class ScenarioInput(BaseModel):
    lead_time_variability_pct: float = 0.0
    demand_increase_pct: float = 0.0
    disrupted_supplier_id: Optional[str] = None
    extra_delay_days: Optional[int] = None


class SKUShortageDetail(BaseModel):
    sku_id: str
    baseline_inventory: float
    scenario_demand: float
    remaining_inventory: float
    shortage_units: float
    shortage_cost: float
    recommended_action: str
    baselineForecasts: dict[str, list[dict[str, str | float]]]
    simulatedForecasts: dict[str, list[dict[str, str | float]]]


class ScenarioResult(BaseModel):
    newStockoutCount: int
    costImpact: float
    affectedSkus: list[str]
    totalShortageUnits: float = 0.0
    skuDetails: list[SKUShortageDetail] = Field(default_factory=list)


# ── Real-time event envelope (from nanditha2) ─────────────────────────────────

class RealtimeEvent(BaseModel):
    type: str
    data: dict
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
