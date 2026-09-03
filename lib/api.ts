import { Alert, InventoryPoint, KPISummary, PurchaseOrder, QueryResponse, ScenarioInput, ScenarioResult } from "../types";
import { MOCK_ALERTS, MOCK_INVENTORY_HISTORY, MOCK_KPIS, MOCK_POS, MOCK_QA_PAIRS } from "./mockData";

// Sleep utility to simulate network latency
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchKPIs(): Promise<KPISummary> {
  await delay(500);
  return MOCK_KPIS;
}

export async function fetchAlerts(): Promise<Alert[]> {
  await delay(600);
  return MOCK_ALERTS;
}

export async function fetchInventoryHistory(): Promise<InventoryPoint[]> {
  await delay(700);
  return MOCK_INVENTORY_HISTORY;
}

export async function fetchPOs(): Promise<PurchaseOrder[]> {
  await delay(600);
  return MOCK_POS;
}

export async function updatePOStatus(id: string, status: "pending" | "approved" | "rejected"): Promise<void> {
  await delay(800);
  const po = MOCK_POS.find(p => p.id === id);
  if (po) {
    po.status = status;
  }
}

export async function queryAgent(question: string): Promise<QueryResponse> {
  await delay(1500);
  
  // Find a matching canned answer, or return a default fallback
  const match = Object.keys(MOCK_QA_PAIRS).find(q => 
    question.toLowerCase().includes(q.toLowerCase().replace('?', ''))
  );
  
  if (match) {
    return MOCK_QA_PAIRS[match];
  }
  
  return {
    answer: "I don't have a specific pre-computed answer for that, but based on current inventory data, our systems are stable. Would you like me to run a deeper analysis on a specific SKU?",
    reasoning: "The question did not match any of our high-priority risk scenarios in the current active context.",
    citations: []
  };
}

export async function runScenario(input: ScenarioInput): Promise<ScenarioResult> {
  await delay(2000);

  // stockoutIncrease: 0 at baseline/negative, scales up with positive inputs
  const stockoutIncrease = Math.max(
    0,
    Math.floor((input.demandIncreasePct / 10) + (input.leadTimeVariabilityPct / 10))
  );

  // costImpact can be negative (savings) or positive (additional spend)
  const costImpact =
    input.demandIncreasePct * 15000 + input.leadTimeVariabilityPct * 8000;

  // Affected SKUs: empty at baseline/negative; grows 1→2→3 as pressure rises
  const ALL_AT_RISK = ["SKU-LITH-007", "SKU-PCB-003", "SKU-STL-001"];
  const affectedSkus = ALL_AT_RISK.slice(0, stockoutIncrease);

  return {
    newStockoutCount: MOCK_KPIS.stockoutRiskCount + stockoutIncrease,
    costImpact,
    affectedSkus,
  };
}
