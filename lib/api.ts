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
  try {
    const res = await fetch("http://127.0.0.1:8000/scenario/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_time_variability_pct: input.leadTimeVariabilityPct,
        demand_increase_pct: input.demandIncreasePct,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        newStockoutCount: data.newStockoutCount ?? 0,
        costImpact: data.costImpact ?? 0,
        affectedSkus: data.affectedSkus ?? [],
      };
    }
  } catch (error) {
    console.warn("Backend /scenario/run unreachable, falling back to local calculation:", error);
  }

  // Graceful local fallback if backend is offline
  await delay(600);
  const stockoutIncrease = Math.max(
    0,
    Math.floor((input.demandIncreasePct / 10) + (input.leadTimeVariabilityPct / 10))
  );
  const costImpact =
    input.demandIncreasePct * 15000 + input.leadTimeVariabilityPct * 8000;
  const ALL_AT_RISK = ["SKU_001", "SKU_002", "SKU_003"];
  const affectedSkus = ALL_AT_RISK.slice(0, stockoutIncrease);

  return {
    newStockoutCount: MOCK_KPIS.stockoutRiskCount + stockoutIncrease,
    costImpact,
    affectedSkus,
  };
}

export async function parseSupplierEmail(rawEmailText: string): Promise<any> {
  try {
    const res = await fetch("http://127.0.0.1:8000/email/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_email_text: rawEmailText }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (error) {
    console.error("parseSupplierEmail backend fetch error:", error);
  }

  // Client-side fallback: parse any custom email directly if backend is offline
  const cleaned = rawEmailText.trim();
  let delay_days = 7;
  const dayMatch = cleaned.match(/(\d+)\s*(?:-| )?(?:business\s+days?|work\s+days?|days?)/i);
  if (dayMatch) {
    delay_days = parseInt(dayMatch[1], 10);
  } else if (/two\s+weeks?|2\s+weeks?/i.test(cleaned)) {
    delay_days = 14;
  } else if (/one\s+week|a\s+week|next\s+week/i.test(cleaned)) {
    delay_days = 7;
  } else if (/couple\s+of\s+days/i.test(cleaned)) {
    delay_days = 3;
  }

  let sku_id = "SKU_001";
  const skuMatch = cleaned.match(/\b(SKU[-_ ]?[A-Za-z0-9_-]+)\b/i);
  if (skuMatch) {
    sku_id = skuMatch[1].replace(" ", "_").replace("-", "_").toUpperCase();
  } else if (/copper|wire/i.test(cleaned)) {
    sku_id = "SKU_001";
  } else if (/resin|polymer/i.test(cleaned)) {
    sku_id = "SKU_002";
  } else if (/chip|silicon/i.test(cleaned)) {
    sku_id = "SKU_003";
  } else if (/steel|sheet/i.test(cleaned)) {
    sku_id = "SKU_004";
  } else if (/battery|lithium/i.test(cleaned)) {
    sku_id = "SKU_006";
  }

  let supplier_id = "SUP-01";
  const supMatch = cleaned.match(/\b(SUP[-_ ]?[A-Za-z0-9]+)\b/i);
  if (supMatch) {
    supplier_id = supMatch[1].replace(" ", "-").toUpperCase();
  }

  const lines = cleaned.split("\n").map(l => l.trim()).filter(l => l && !/^(dear|hello|hi|regards|best|thanks)/i.test(l));
  const snippet = lines[0] ? (lines[0].length > 80 ? lines[0].slice(0, 77) + "..." : lines[0]) : "Supplier delay notification";

  return {
    supplier_id,
    sku_id,
    delay_days,
    summary: `Supplier notice: ${snippet} (${delay_days}d delay on ${sku_id})`,
    affected_orders: (cleaned.match(/\b(?:ORD|ORDER|PO|REF)[-_ ][A-Za-z0-9]+\b|#\d{4,8}/gi) || []),
    stockout_risk_triggered: true,
    created_alert_id: `ALERT-DELAY-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
  };
}

export async function fetchScenarioHistory(): Promise<any[]> {
  try {
    const res = await fetch("http://127.0.0.1:8000/scenario/history");
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("fetchScenarioHistory failed:", e);
  }
  return [];
}

export async function fetchEmailHistory(): Promise<any[]> {
  try {
    const res = await fetch("http://127.0.0.1:8000/email/history");
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("fetchEmailHistory failed:", e);
  }
  return [];
}
