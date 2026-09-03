"""
Pydantic models for the AI Procurement Agent backend.
These define the shape of every request/response so the LLM's outputs
can be validated instead of trusted blindly.
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import date, datetime


class InventoryItem(BaseModel):
    sku_id: str
    site_id: str
    current_stock: int
    reorder_point: int


class ForecastResult(BaseModel):
    sku_id: str
    horizon_days: int
    predicted_demand: int
    confidence_low: int
    confidence_high: int


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
    # NEW (additive — does not break existing frontend field names)
    generated_by: Literal["llm", "fallback"] = "llm"
    created_at: date = Field(default_factory=date.today)


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
    affected_orders: list[str] = Field(default_factory=list)
    new_lead_time_days: Optional[int] = None
    stockout_risk_triggered: bool = False
    created_alert_id: Optional[str] = None


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


class ScenarioResult(BaseModel):
    newStockoutCount: int
    costImpact: float
    affectedSkus: list[str]
    totalShortageUnits: float = 0.0
    skuDetails: list[SKUShortageDetail] = Field(default_factory=list)


class RealtimeEvent(BaseModel):
    type: str
    data: dict
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
