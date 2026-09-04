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
    # reorder_level: explicit threshold used by supplier outreach is_low_stock().
    # Defaults to 0 so is_low_stock() falls back to reorder_point when unset.
    # Prajwal / forecasting team can set this to 1.5× avg monthly usage per SKU.
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
    # Task 5: Idempotent approval guard — never exposed to frontend, internal only
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
