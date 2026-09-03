import { Alert, InventoryPoint, KPISummary, PurchaseOrder, QueryResponse, ScenarioInput, ScenarioResult } from "../types";
import { MOCK_ALERTS, MOCK_INVENTORY_HISTORY, MOCK_KPIS, MOCK_POS, MOCK_QA_PAIRS } from "./mockData";

// Sleep utility to simulate network latency
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchKPIs(): Promise<KPISummary> {
  try {
    const res = await fetch("http://127.0.0.1:8000/kpis");
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchKPIs failed, falling back to mock", e);
  }
  await delay(500);
  return MOCK_KPIS;
}

export async function fetchAlerts(): Promise<Alert[]> {
  try {
    const res = await fetch("http://127.0.0.1:8000/alerts");
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchAlerts failed, falling back to mock", e);
  }
  await delay(600);
  return MOCK_ALERTS;
}

export async function fetchInventoryHistory(): Promise<InventoryPoint[]> {
  try {
    const res = await fetch("http://127.0.0.1:8000/inventory-history");
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchInventoryHistory failed, falling back to mock", e);
  }
  await delay(700);
  return MOCK_INVENTORY_HISTORY;
}

export async function fetchPOs(): Promise<PurchaseOrder[]> {
  try {
    const res = await fetch("http://127.0.0.1:8000/agent/pos-frontend");
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchPOs failed, falling back to mock", e);
  }
  await delay(600);
  return MOCK_POS;
}

export async function updatePOStatus(id: string, status: "pending" | "approved" | "rejected"): Promise<void> {
  if (status === "approved") {
    try {
      await fetch(`http://127.0.0.1:8000/agent/approve/${id}`, { method: "POST" });
      return;
    } catch (e) {
      console.error(e);
    }
  } else if (status === "rejected") {
    try {
      await fetch(`http://127.0.0.1:8000/agent/reject/${id}`, { method: "POST" });
      return;
    } catch (e) {
      console.error(e);
    }
  }
  
  // Fallback to mock
  await delay(800);
  const po = MOCK_POS.find(p => p.id === id);
  if (po) {
    po.status = status;
  }
}

export async function queryAgent(question: string): Promise<QueryResponse> {
  try {
    const res = await fetch("http://127.0.0.1:8000/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });
    if (res.ok) return await res.json();
  } catch (error) {
    console.error("Agent query failed:", error);
  }
  
  // Fallback to mock
  await delay(1500);
  const match = Object.keys(MOCK_QA_PAIRS).find(q => 
    question.toLowerCase().includes(q.toLowerCase().replace('?', ''))
  );
  if (match) return MOCK_QA_PAIRS[match];
  return {
    answer: "I couldn't reach the backend LLM (is port 8000 running?), and no canned answer matched your question.",
    reasoning: "Fallback triggered.",
    citations: []
  };
}

export async function uploadDataset(file: File): Promise<{ success: boolean; message: string }> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    
    const res = await fetch("http://127.0.0.1:8000/upload-dataset", {
      method: "POST",
      body: formData,
    });
    
    if (res.ok) {
      const data = await res.json();
      return { success: true, message: data.message };
    } else {
      return { success: false, message: "Upload failed on the server." };
    }
  } catch (error) {
    console.error("Upload error:", error);
    return { success: false, message: "Network error occurred." };
  }
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
