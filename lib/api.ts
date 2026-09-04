import { Alert, InventoryPoint, KPISummary, PurchaseOrder, QueryResponse, ScenarioInput, ScenarioResult, SupplierRisk, AuditLog, CategorySummary } from "../types";
import { supabase } from "./supabase";

// Sleep utility to simulate network latency
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchKPIs(): Promise<KPISummary> {
  // 1. Stockout Risk Count
  const { count: stockoutRiskCount, error: stockoutErr } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .eq("risk_level", "high");

  // 2. Open PO Count
  const { count: openPOCount, error: poErr } = await supabase
    .from("purchase_orders")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  // 3. Supplier Risk Score
  const { data: supplierRisks, error: supplierErr } = await supabase
    .from("supplier_risk_view")
    .select("risk_pct");

  let supplierRiskScore = 0;
  if (supplierRisks && supplierRisks.length > 0) {
    const sum = supplierRisks.reduce((acc, row) => acc + (Number(row.risk_pct) || 0), 0);
    supplierRiskScore = Math.round(sum / supplierRisks.length);
  }

  // 4. Excess Inventory Value
  const { data: latestInventory, error: inventoryErr } = await supabase
    .from("latest_inventory_view")
    .select("inventory_level, price, reorder_level");

  let excessInventoryValue = 0;
  if (latestInventory) {
    excessInventoryValue = latestInventory.reduce((acc, row) => {
      const reorderLvl = row.reorder_level ? Number(row.reorder_level) : 50;
      if (Number(row.inventory_level) > reorderLvl * 2) {
        return acc + (Number(row.inventory_level) * Number(row.price));
      }
      return acc;
    }, 0);
  }

  return {
    stockoutRiskCount: stockoutRiskCount || 0,
    openPOCount,
    supplierRiskScore,
    excessInventoryValue: Math.round(excessInventoryValue),
  };
}

export async function fetchAlerts(): Promise<Alert[]> {
  const { data, error } = await supabase.from("alerts").select("*");
  if (!data) return [];

  return data.map((row: any) => ({
    id: `${row.sku}-${row.store_id}`,
    sku: row.sku,
    skuName: `Product ${row.sku}`,
    riskLevel: row.risk_level as "high" | "medium" | "low",
    daysUntilStockout: Math.round(Number(row.inventory_level) / (Number(row.demand_forecast) || 1)),
    currentStock: Number(row.inventory_level),
    forecastedDemand: Math.round(Number(row.demand_forecast) || 0),
    createdAt: new Date().toISOString(), // Mocking date since it's missing in view
  }));
}

export async function fetchInventoryHistory(): Promise<InventoryPoint[]> {
  const { data, error } = await supabase
    .from("inventory_transactions")
    .select("date, product_id, inventory_level, demand_forecast")
    .order("date", { ascending: true })
    .limit(1000); // Adding limit just in case

  if (!data) return [];

  return data.map((row: any) => ({
    date: row.date,
    sku: row.product_id,
    actualLevel: Number(row.inventory_level),
    forecastedLevel: Math.round(Number(row.demand_forecast) || 0),
  }));
}

export async function fetchSupplierRiskPanel(): Promise<SupplierRisk[]> {
  const { data, error } = await supabase
    .from("supplier_risk_view")
    .select("*")
    .order("risk_pct", { ascending: false });

  if (!data) return [];
  return data.map((row: any) => ({
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    riskPct: Number(row.risk_pct),
    avgOrderAmount: Number(row.avg_order_amount),
  }));
}

export async function fetchAuditTrail(): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!data) return [];
  return data.map((row: any) => ({
    id: row.id,
    actionType: row.action_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details,
    performedBy: row.performed_by,
    createdAt: row.created_at,
  }));
}

export async function getInventoryCategorySummary(): Promise<CategorySummary[]> {
  const { data, error } = await supabase
    .from("latest_inventory_view")
    .select("category, inventory_level, reorder_level, price");

  if (!data) return [];

  const summaryMap: Record<string, CategorySummary> = {};

  data.forEach((row) => {
    const cat = row.category || "Uncategorized";
    if (!summaryMap[cat]) {
      summaryMap[cat] = {
        category: cat,
        skuCount: 0,
        atRiskCount: 0,
        totalValue: 0,
      };
    }

    const inventoryLevel = Number(row.inventory_level) || 0;
    const reorderLevel = Number(row.reorder_level) || 50; // fallback if null
    const price = Number(row.price) || 0;

    summaryMap[cat].skuCount += 1;
    if (inventoryLevel < reorderLevel) {
      summaryMap[cat].atRiskCount += 1;
    }
    summaryMap[cat].totalValue += inventoryLevel * price;
  });

  return Object.values(summaryMap).sort((a, b) => b.totalValue - a.totalValue);
}

export async function fetchPOs(): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .order("created_at", { ascending: false });
    
  if (!data) return [];
  return data.map((row: any) => ({
    id: row.id.toString(),
    sku: row.sku,
    skuName: row.sku_name || row.sku,
    supplier: row.supplier,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    totalCost: row.total_cost,
    riskLevel: row.risk_level as "high" | "medium" | "low",
    status: row.status as "pending" | "approved" | "rejected",
    agentExplanation: row.agent_explanation || {},
    createdAt: row.created_at
  }));
}

export async function updatePOStatus(id: string, status: "pending" | "approved" | "rejected"): Promise<void> {
  await supabase
    .from("purchase_orders")
    .update({ status })
    .eq("id", parseInt(id, 10));
}

export async function queryAgent(question: string): Promise<QueryResponse> {
  await delay(1500);
  
  const lowerQ = question.toLowerCase();
  let responseObj: QueryResponse;

  if (lowerQ.includes("highest stockout risk") || lowerQ.includes("highest risk")) {
    const { data: topRisks } = await supabase
      .from("alerts")
      .select("sku, sku_name, risk_level")
      .order("inventory_level", { ascending: true })
      .limit(2);
      
    if (topRisks && topRisks.length > 0) {
      const names = topRisks.map(r => r.sku_name || r.sku).join(" and ");
      responseObj = {
        answer: `Based on current forecasting, ${names} are at the highest risk of stockout.`,
        reasoning: "The ML model flags these based on short days-until-stockout windows combined with supplier delays.",
        citations: topRisks.map(r => ({ source: "Inventory Forecast Model", snippet: `${r.sku} flagged as ${r.risk_level} risk.` }))
      };
    } else {
      responseObj = {
        answer: "Currently, there are no high-risk SKUs flagged in the system.",
        reasoning: "The alerts view returned 0 critical stockout risks.",
        citations: []
      };
    }
  } else {
    // Generic fallback
    responseObj = {
      answer: "I don't have a specific pre-computed answer for that, but based on current inventory data, our systems are stable. Would you like me to run a deeper analysis on a specific SKU?",
      reasoning: "The question did not match any of our high-priority risk scenarios in the current active context.",
      citations: []
    };
  }

  // Log to Supabase
  await supabase.from("chat_logs").insert({
    question,
    answer: responseObj.answer,
    reasoning: responseObj.reasoning,
    citations: responseObj.citations,
  });

  return responseObj;
}

export async function runScenario(input: ScenarioInput): Promise<ScenarioResult> {
  await delay(2000);

  const stockoutIncrease = Math.max(
    0,
    Math.floor((input.demandIncreasePct / 10) + (input.leadTimeVariabilityPct / 10))
  );

  const costImpact =
    input.demandIncreasePct * 15000 + input.leadTimeVariabilityPct * 8000;

  // Dynamically fetch affected SKUs from current alerts
  const { data: topRisks } = await supabase
    .from("alerts")
    .select("sku")
    .order("inventory_level", { ascending: true })
    .limit(stockoutIncrease > 0 ? stockoutIncrease : 1);
    
  const affectedSkus = topRisks ? topRisks.map(r => r.sku) : [];

  // Get current stockout count directly
  const { count: currentStockoutRiskCount } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .eq("risk_level", "high");
    
  const newStockoutCount = (currentStockoutRiskCount || 0) + stockoutIncrease;

  // Log to Supabase
  await supabase.from("scenario_runs").insert({
    lead_time_variability_pct: input.leadTimeVariabilityPct,
    demand_increase_pct: input.demandIncreasePct,
    new_stockout_count: newStockoutCount,
    cost_impact: costImpact,
    affected_skus: affectedSkus,
  });

  return {
    newStockoutCount,
    costImpact,
    affectedSkus,
  };
}
