import {
  Alert,
  AlertsStatus,
  AuditLogEntry,
  EmailParseResult,
  InventoryPoint,
  KPISummary,
  PurchaseOrder,
  QueryResponse,
  ScenarioInput,
  ScenarioResult,
  SupplierRiskItem,
} from "../types";
import {
  MOCK_ALERTS,
  MOCK_AUDIT_LOGS,
  MOCK_INVENTORY_HISTORY,
  MOCK_KPIS,
  MOCK_POS,
  MOCK_QA_PAIRS,
  MOCK_SUPPLIER_RISKS,
} from "./mockData";

// Sleep utility to simulate network latency on fallback
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchKPIs(): Promise<KPISummary> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/kpis?t=${Date.now()}`);
    if (res.ok) return await res.json();
    const resFallback = await fetch(`http://127.0.0.1:8000/kpi?t=${Date.now()}`);
    if (resFallback.ok) return await resFallback.json();
  } catch (e) {
    console.error("fetchKPIs failed, falling back to mock", e);
  }
  await delay(300);
  return MOCK_KPIS;
}

export async function fetchAlerts(): Promise<Alert[]> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/risk/alerts?t=${Date.now()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchAlerts failed, falling back to mock", e);
  }
  await delay(350);
  return MOCK_ALERTS;
}

export async function fetchInventoryHistory(): Promise<InventoryPoint[]> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/inventory-history?t=${Date.now()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchInventoryHistory failed, falling back to mock", e);
  }
  await delay(400);
  return MOCK_INVENTORY_HISTORY;
}

export async function fetchPOs(): Promise<PurchaseOrder[]> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/agent/pos-frontend?t=${Date.now()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchPOs failed, falling back to mock", e);
  }
  await delay(350);
  return MOCK_POS;
}

export async function fetchSupplierRisks(): Promise<SupplierRiskItem[]> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/supplier-risk?t=${Date.now()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchSupplierRisks failed, falling back to mock", e);
  }
  await delay(350);
  return MOCK_SUPPLIER_RISKS;
}

export async function fetchAuditLogs(): Promise<AuditLogEntry[]> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/audit-log?t=${Date.now()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("fetchAuditLogs failed, falling back to mock", e);
  }
  await delay(350);
  return MOCK_AUDIT_LOGS;
}

export async function fetchAlertsStatus(): Promise<AlertsStatus> {
  try {
    const res = await fetch(`http://127.0.0.1:8000/alerts/status?t=${Date.now()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    // Graceful check fallback
  }
  return { configured: false, channel: "Slack" };
}

export async function updatePOStatus(
  id: string,
  status: "pending" | "approved" | "rejected"
): Promise<void> {
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
  await delay(500);
  const po = MOCK_POS.find((p) => p.id === id);
  if (po) {
    po.status = status;
  }
}

export async function queryAgent(question: string): Promise<QueryResponse> {
  try {
    const res = await fetch("http://127.0.0.1:8000/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (res.ok) return await res.json();
  } catch (error) {
    console.error("Agent query failed:", error);
  }

  // Fallback to mock
  await delay(800);
  const match = Object.keys(MOCK_QA_PAIRS).find((q) =>
    question.toLowerCase().includes(q.toLowerCase().replace("?", ""))
  );
  if (match) return MOCK_QA_PAIRS[match];
  return {
    answer:
      "I couldn't reach the backend LLM (is port 8000 running?), and no canned answer matched your question.",
    reasoning: "Fallback triggered.",
    citations: [],
  };
}

export async function uploadDataset(
  file: File
): Promise<{ success: boolean; message: string }> {
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
    Math.floor(input.demandIncreasePct / 10 + input.leadTimeVariabilityPct / 10)
  );
  const costImpact =
    input.demandIncreasePct * 15000 + input.leadTimeVariabilityPct * 8000;
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
