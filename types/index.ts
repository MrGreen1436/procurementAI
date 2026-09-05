export type RiskLevel = "high" | "medium" | "low";

export interface Alert {
  id: string;
  sku: string;
  skuName: string;
  riskLevel: RiskLevel;
  daysUntilStockout: number | null;
  currentStock: number;
  forecastedDemand: number;
  createdAt: string; // ISO
}

export interface PurchaseOrder {
  id: string;
  sku: string;
  skuName: string;
  supplier: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  subtotal?: number;
  tax_rate?: number;
  tax_amount?: number;
  riskLevel: RiskLevel;
  status: "pending" | "approved" | "rejected";
  reasoning?: string;
  agentExplanation: {
    whySupplier: string;
    whyQuantity: string;
    whyCost: string;
  };
  quotedByCall?: boolean;
  callQuotePrice?: number | null;
  createdAt: string;
}

export interface KPISummary {
  stockoutRiskCount: number;
  excessInventoryValue: number; // USD
  openPOCount: number;
  supplierRiskScore: number; // 0-100
}

export interface InventoryPoint {
  date: string;
  sku: string;
  actualLevel: number | null;
  forecastedLevel: number;
  etsForecastedLevel?: number;
  lstmForecastedLevel?: number;
}

export interface QueryResponse {
  answer: string;
  reasoning: string;
  citations: { source: string; snippet: string }[];
}

export interface ScenarioInput {
  leadTimeVariabilityPct: number;
  demandIncreasePct: number;
  disrupted_supplier_id?: string | null;
  extra_delay_days?: number | null;
}

export interface ForecastPoint {
  date: string;
  value: number;
}

export interface ForecastSeriesBundle {
  xgboost: ForecastPoint[];
  lstm: ForecastPoint[];
  ets: ForecastPoint[];
}

export interface SKUShortageDetail {
  sku_id: string;
  baseline_inventory: number;
  scenario_demand: number;
  remaining_inventory: number;
  shortage_units: number;
  shortage_cost: number;
  recommended_action: string;
  baselineForecasts?: ForecastSeriesBundle;
  simulatedForecasts?: ForecastSeriesBundle;
}

export interface ScenarioResult {
  newStockoutCount: number;
  costImpact: number;
  affectedSkus: string[];
  totalShortageUnits: number;
  skuDetails: SKUShortageDetail[];
}

export interface EmailParseResult {
  supplier_id?: string | null;
  sku_id?: string | null;
  delay_days?: number | null;
  summary: string;
  affected_orders?: string[];
  new_lead_time_days?: number | null;
  stockout_risk_triggered?: boolean;
  created_alert_id?: string | null;
  persisted_email_id?: number | null;
}

export interface CategorySummary {
  category: string;
  skuCount: number;
  atRiskCount: number;
  totalValue: number;
}

export interface InventoryRow {
  id?: number;
  date: string;
  store_id: string;
  product_id: string;
  category: string | null;
  region: string | null;
  inventory_level: number;
  reorder_level: number | null;
  price: number | null;
  supplier_name: string | null;
  discount: number | null;
  competitor_pricing: number | null;
  seasonality: string | null;
  weather_condition: string | null;
  holiday_promotion: boolean | null;
  is_anomaly: boolean;
  anomaly_reason: string | null;
}

export interface InventoryDatasetStatus {
  has_dataset: boolean;
  filename?: string | null;
  row_count?: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string;
  details: Record<string, any>;
  status: "success" | "warning" | "info" | "failure";
  createdAt: string;
}

