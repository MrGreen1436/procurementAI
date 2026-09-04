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
  eoq?: number;
  safetyStock?: number;
  reorderPoint?: number;
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
  actualLevel: number;
  forecastedLevel: number;
}

export interface QueryResponse {
  answer: string;
  reasoning: string;
  citations: { source: string; snippet: string }[];
}

export interface ScenarioInput {
  leadTimeVariabilityPct: number; // slider, e.g. -20 to +50
  demandIncreasePct: number; // slider, e.g. -20 to +50
}

export interface ScenarioResult {
  newStockoutCount: number;
  costImpact: number; // USD delta
  affectedSkus: string[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  actorType?: string;
  action: string;
  target?: string;
  target_id?: string;
  status?: "success" | "warning" | "error" | "info";
  details?: string;
}

export interface SupplierRiskItem {
  supplier_id: string;
  supplier_name: string;
  risk_score: number;
  label: "red" | "yellow" | "green" | "insufficient_data";
  anomaly_rate: number;
  weekend_rate: number;
  avg_amount: number;
  n_rows: number;
  trust_score?: number; // merged from /supplier-trust-scores
}

export interface CallQuote {
  id: number;
  supplier_name: string;
  phone_number: string;
  item_name: string;
  raw_transcript: string | null;
  extracted_price: number | null;
  call_sid: string;
  created_at: string;
}
