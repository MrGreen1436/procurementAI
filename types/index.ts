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
  riskLevel: RiskLevel;
  status: "pending" | "approved" | "rejected";
  agentExplanation: {
    whySupplier: string;
    whyQuantity: string;
    whyCost: string;
  };
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

export interface SKUShortageDetail {
  sku_id: string;
  baseline_inventory: number;
  scenario_demand: number;
  remaining_inventory: number;
  shortage_units: number;
  shortage_cost: number;
  recommended_action: string;
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
