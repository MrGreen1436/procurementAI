import { Alert, EmailParseResult, InventoryPoint, KPISummary, PurchaseOrder, QueryResponse, ScenarioInput, ScenarioResult, AuditLogEntry } from "../types";
import { MOCK_ALERTS, MOCK_INVENTORY_HISTORY, MOCK_KPIS, MOCK_POS, MOCK_QA_PAIRS } from "./mockData";

// Sleep utility to simulate network latency
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchKPIs(): Promise<KPISummary> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/kpi?t=${Date.now()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchKPIs failed, falling back to mock", e);
  }
  await delay(500);
  return MOCK_KPIS;
}

export async function fetchAlerts(): Promise<Alert[]> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/risk/alerts?t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      return data.map((d: any) => {
        const days = d.predicted_stockout_date
          ? Math.max(1, Math.round((new Date(d.predicted_stockout_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
          : (d.daysUntilStockout ?? 1);
        return {
          id: d.id || d.alert_id || `alert-${Math.random()}`,
          sku: d.sku || d.sku_id || "SKU-001",
          skuName: d.skuName || d.sku_id || "Product",
          riskLevel: d.riskLevel || d.risk_level || "high",
          daysUntilStockout: days,
          currentStock: d.currentStock ?? d.current_stock ?? 150,
          forecastedDemand: d.forecastedDemand ?? d.forecasted_demand ?? 950,
          createdAt: d.createdAt || d.created_at || new Date().toISOString(),
        };
      });
    }
  } catch (e) {
    console.error("fetchAlerts failed, falling back to mock", e);
  }
  await delay(600);
  return MOCK_ALERTS;
}

export async function fetchInventoryHistory(): Promise<InventoryPoint[]> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/inventory-history?t=${Date.now()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchInventoryHistory failed, falling back to mock", e);
  }
  await delay(700);
  return MOCK_INVENTORY_HISTORY;
}

export async function fetchPOs(): Promise<PurchaseOrder[]> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/agent/pos-frontend?t=${Date.now()}`);
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
    const res = await fetch("http://127.0.0.1:8000/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_time_variability_pct: input.leadTimeVariabilityPct,
        demand_increase_pct: input.demandIncreasePct,
        disrupted_supplier_id: input.disrupted_supplier_id,
        extra_delay_days: input.extra_delay_days,
      }),
    });
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("Scenario simulation failed:", e);
  }

  // Fallback mock
  const stockoutIncrease = Math.max(
    0,
    Math.floor((input.demandIncreasePct / 10) + (input.leadTimeVariabilityPct / 10))
  );
  const costImpact = input.demandIncreasePct * 15000 + input.leadTimeVariabilityPct * 8000;
  const ALL_AT_RISK = ["SKU_001", "SKU_003", "SKU_005"];
  const affectedSkus = ALL_AT_RISK.slice(0, stockoutIncrease);
  return {
    newStockoutCount: stockoutIncrease,
    costImpact,
    affectedSkus,
    totalShortageUnits: 0,
    skuDetails: [],
  };
}

export async function parseEmail(emailText: string): Promise<EmailParseResult> {
  const res = await fetch("http://127.0.0.1:8000/email/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw_email_text: emailText }),
  });
  if (!res.ok) throw new Error(`Email parse failed: ${res.status}`);
  return res.json();
}

export const parseSupplierEmail = parseEmail;

import { CategorySummary, InventoryRow, InventoryDatasetStatus } from "../types";

export async function fetchInventoryStatus(): Promise<InventoryDatasetStatus> {
  try {
    const res = await fetch("http://127.0.0.1:8000/api/inventory/status");
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchInventoryStatus error:", e);
  }
  return { has_dataset: false, filename: null, row_count: 0 };
}

export async function getInventoryCategorySummary(site_id?: string): Promise<CategorySummary[]> {
  try {
    const url = site_id ? `http://127.0.0.1:8000/api/inventory/summary?site_id=${encodeURIComponent(site_id)}` : "http://127.0.0.1:8000/api/inventory/summary";
    const res = await fetch(url);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("getInventoryCategorySummary error:", e);
  }
  // Strictly no hardcoded fallback if dataset is missing
  return [];
}

export async function fetchInventoryTransactions(category?: string | null, site_id?: string): Promise<InventoryRow[]> {
  try {
    const params = new URLSearchParams();
    if (category) params.append("category", category);
    if (site_id) params.append("site_id", site_id);
    const qs = params.toString();
    const url = qs ? `http://127.0.0.1:8000/api/inventory/transactions?${qs}` : "http://127.0.0.1:8000/api/inventory/transactions";
    const res = await fetch(url);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchInventoryTransactions error:", e);
  }
  // Strictly no hardcoded fallback if dataset is missing
  return [];
}

export async function adjustStock(data: { store_id: string; product_id: string; inventory_level: number }) {
  const res = await fetch("http://127.0.0.1:8000/api/inventory/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Stock adjustment failed: ${res.status}`);
  return res.json();
}

export async function resetInventoryDataset() {
  const res = await fetch("http://127.0.0.1:8000/api/inventory/reset", {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
  return res.json();
}

export async function fetchAuditLogs(params?: {
  entityType?: string;
  action?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; logs: AuditLogEntry[] }> {
  try {
    const q = new URLSearchParams();
    if (params?.entityType && params.entityType !== "all") q.set("entity_type", params.entityType);
    if (params?.action && params.action !== "all") q.set("action", params.action);
    if (params?.search) q.set("search", params.search);
    if (params?.limit) q.set("limit", params.limit.toString());
    if (params?.offset) q.set("offset", params.offset.toString());
    q.set("t", Date.now().toString());

    const res = await fetch(`http://127.0.0.1:8000/api/audit-trail?${q.toString()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchAuditLogs error:", e);
  }
  return { total: 0, logs: [] };
}

export async function fetchWarehouses() {
  const res = await fetch("http://127.0.0.1:8000/api/warehouses");
  if (!res.ok) throw new Error("Failed to fetch warehouses");
  return res.json();
}

export async function reportMarketEvent(text: string) {
  const res = await fetch("http://127.0.0.1:8000/events/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_text: text }),
  });
  if (!res.ok) throw new Error("Failed to report market event");
  return res.json();
}

export async function simulateDeliveryDelay(payload: {
  raw_email_text?: string;
  sku_id?: string;
  delay_days?: number;
  supplier_name?: string;
  incoming_qty?: number;
}) {
  const res = await fetch("http://127.0.0.1:8000/api/simulate-delivery-delay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to simulate delivery delay");
  return res.json();
}

