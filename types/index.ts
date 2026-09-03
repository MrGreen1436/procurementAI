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
