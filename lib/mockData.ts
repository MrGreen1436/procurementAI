import { Alert, InventoryPoint, KPISummary, PurchaseOrder, QueryResponse, SupplierRiskItem, AuditLogEntry } from "../types";

export const SKUS = [
  { sku: "SKU-STL-001", name: "Steel Coil - Industrial" },
  { sku: "SKU-RES-002", name: "Resin Pellets - Type A" },
  { sku: "SKU-PCB-003", name: "PCB Substrate Board" },
  { sku: "SKU-ALU-004", name: "Aluminum Sheet - 5mm" },
  { sku: "SKU-GLS-005", name: "Tempered Glass Panel" },
  { sku: "SKU-COP-006", name: "Copper Wire - 12 AWG" },
  { sku: "SKU-LITH-007", name: "Lithium Ion Cells" },
  { sku: "SKU-PLA-008", name: "Plastic Casing Module" },
  { sku: "SKU-SIL-009", name: "Silicon Wafers" },
  { sku: "SKU-RBR-010", name: "Rubber Gaskets" },
  { sku: "SKU-FST-011", name: "Titanium Fasteners" },
  { sku: "SKU-ADH-012", name: "Industrial Adhesive" },
  { sku: "SKU-LED-013", name: "LED Matrix Panels" },
  { sku: "SKU-MTR-014", name: "Micro Motors - 5V" },
  { sku: "SKU-SEN-015", name: "Temperature Sensors" }
];

export const MOCK_KPIS: KPISummary = {
  stockoutRiskCount: 6,
  excessInventoryValue: 1245000,
  openPOCount: 5,
  supplierRiskScore: 68
};

export const MOCK_ALERTS: Alert[] = [
  {
    id: "alt-1",
    sku: "SKU-LITH-007",
    skuName: "Lithium Ion Cells",
    riskLevel: "high",
    daysUntilStockout: 4,
    currentStock: 1200,
    forecastedDemand: 3500,
    createdAt: new Date().toISOString(),
  },
  {
    id: "alt-2",
    sku: "SKU-PCB-003",
    skuName: "PCB Substrate Board",
    riskLevel: "high",
    daysUntilStockout: 2,
    currentStock: 450,
    forecastedDemand: 2100,
    createdAt: new Date().toISOString(),
  },
  {
    id: "alt-3",
    sku: "SKU-SIL-009",
    skuName: "Silicon Wafers",
    riskLevel: "medium",
    daysUntilStockout: 12,
    currentStock: 8000,
    forecastedDemand: 12000,
    createdAt: new Date().toISOString(),
  },
  {
    id: "alt-4",
    sku: "SKU-RES-002",
    skuName: "Resin Pellets - Type A",
    riskLevel: "low",
    daysUntilStockout: 45,
    currentStock: 50000,
    forecastedDemand: 25000,
    createdAt: new Date().toISOString(),
  },
  {
    id: "alt-5",
    sku: "SKU-GLS-005",
    skuName: "Tempered Glass Panel",
    riskLevel: "medium",
    daysUntilStockout: 18,
    currentStock: 1500,
    forecastedDemand: 3200,
    createdAt: new Date().toISOString(),
  },
  {
    id: "alt-6",
    sku: "SKU-COP-006",
    skuName: "Copper Wire - 12 AWG",
    riskLevel: "high",
    daysUntilStockout: 6,
    currentStock: 2500,
    forecastedDemand: 8000,
    createdAt: new Date().toISOString(),
  }
];

export const MOCK_POS: PurchaseOrder[] = [
  {
    id: "po-101",
    sku: "SKU-LITH-007",
    skuName: "Lithium Ion Cells",
    supplier: "Global Energy Corp",
    quantity: 10000,
    unitCost: 12.50,
    totalCost: 125000,
    riskLevel: "high",
    status: "pending",
    agentExplanation: {
      whySupplier: "Global Energy Corp has the shortest lead time (7 days) mitigating the immediate stockout risk.",
      whyQuantity: "10,000 units covers the projected deficit and provides a 15% safety buffer for next month.",
      whyCost: "$12.50 is slightly above average, but expedited shipping is included to prevent production halt."
    },
    createdAt: new Date().toISOString()
  },
  {
    id: "po-102",
    sku: "SKU-PCB-003",
    skuName: "PCB Substrate Board",
    supplier: "TechCircuits Ltd",
    quantity: 5000,
    unitCost: 8.20,
    totalCost: 41000,
    riskLevel: "high",
    status: "pending",
    agentExplanation: {
      whySupplier: "Primary supplier is delayed; TechCircuits has available stock.",
      whyQuantity: "Matches exactly the shortfall for the upcoming 2 weeks.",
      whyCost: "Standard negotiated rate applies."
    },
    createdAt: new Date().toISOString()
  },
  {
    id: "po-103",
    sku: "SKU-STL-001",
    skuName: "Steel Coil - Industrial",
    supplier: "MetalWorks Inc",
    quantity: 500,
    unitCost: 450,
    totalCost: 225000,
    riskLevel: "medium",
    status: "pending",
    agentExplanation: {
      whySupplier: "Strategic partner with lowest bulk pricing.",
      whyQuantity: "Fulfilling quarterly forecast requirements.",
      whyCost: "Volume discount applied (-5%)."
    },
    createdAt: new Date().toISOString()
  },
  {
    id: "po-104",
    sku: "SKU-COP-006",
    skuName: "Copper Wire - 12 AWG",
    supplier: "WireCo Global",
    quantity: 8000,
    unitCost: 2.10,
    totalCost: 16800,
    riskLevel: "medium",
    status: "pending",
    agentExplanation: {
      whySupplier: "WireCo offers the most reliable delivery windows for raw copper.",
      whyQuantity: "Aligns with expected production ramp-up for next quarter.",
      whyCost: "Locked in at previous quarter rates, avoiding recent 3% market spike."
    },
    createdAt: new Date().toISOString()
  },
  {
    id: "po-105",
    sku: "SKU-ALU-004",
    skuName: "Aluminum Sheet - 5mm",
    supplier: "AluForge Partners",
    quantity: 2000,
    unitCost: 45.00,
    totalCost: 90000,
    riskLevel: "low",
    status: "pending",
    agentExplanation: {
      whySupplier: "Preferred supplier for high-grade aluminum.",
      whyQuantity: "Standard replenishment cycle order.",
      whyCost: "Within 2% of our targeted unit cost baseline."
    },
    createdAt: new Date().toISOString()
  }
];

// Generate 60 days of history for each SKU
export const generateInventoryHistory = (): InventoryPoint[] => {
  const points: InventoryPoint[] = [];
  const today = new Date();
  
  SKUS.forEach(skuObj => {
    // Determine base level and volatility per SKU
    let currentActual = 1000 + Math.random() * 9000;
    
    for (let i = 60; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      
      const dateStr = d.toISOString().split('T')[0];
      
      // Add some random noise
      currentActual = Math.max(0, currentActual + (Math.random() * 400 - 200));
      
      // Forecast is usually close to actual in the past, maybe slightly off
      const forecasted = Math.max(0, currentActual + (Math.random() * 200 - 100));
      
      points.push({
        date: dateStr,
        sku: skuObj.sku,
        actualLevel: Math.round(currentActual),
        forecastedLevel: Math.round(forecasted)
      });
    }
  });
  
  return points;
};

export const MOCK_INVENTORY_HISTORY = generateInventoryHistory();

export const MOCK_QA_PAIRS: Record<string, QueryResponse> = {
  "Which SKUs are at highest stockout risk?": {
    answer: "Based on current forecasting, Lithium Ion Cells (SKU-LITH-007) and PCB Substrate Board (SKU-PCB-003) are at the highest risk of stockout.",
    reasoning: "The ML model predicts a stockout in 4 days for Lithium Ion Cells due to a sudden 35% surge in forecasted demand, while current stock is critically low. PCB Substrates have a supplier delay combined with steady demand, pushing stockout risk to 2 days.",
    citations: [
      { source: "Inventory Forecast Model v2", snippet: "SKU-LITH-007 predicted depletion: 96 hours." },
      { source: "Supplier Risk Alert", snippet: "TechCircuits Ltd reports 5-day delay on PCB shipments." }
    ]
  },
  "Why did we order more resin pellets this month?": {
    answer: "We increased the order volume for Resin Pellets because the predictive pricing model expects a 12% cost increase next quarter due to raw material shortages.",
    reasoning: "Agent analysis shows that carrying costs for the excess inventory are lower than the projected price hike. By buying now, we optimize total expenditure while securing supply for upcoming peak production.",
    citations: [
      { source: "Commodity Price Forecast", snippet: "Petrochemical derivatives expected to rise 10-15% in Q4." },
      { source: "Cost Optimization Agent", snippet: "Recommended early bulk purchase of SKU-RES-002; estimated saving $14,000." }
    ]
  },
  "What is the current risk level for TechCircuits Ltd?": {
    answer: "TechCircuits Ltd currently has a high risk score of 82/100 due to recent delivery delays and a localized labor strike.",
    reasoning: "Our supplier monitoring system flagged a 5-day average delay over their last 3 shipments. External news sentiment analysis confirmed a pending labor strike at their primary logistics hub, elevating the risk score.",
    citations: [
      { source: "Supplier Performance DB", snippet: "Avg delay for TechCircuits Ltd (last 30 days): +5.2 days." },
      { source: "Global Supply Chain News", snippet: "Logistics union announces strike affecting major tech hubs starting next week." }
    ]
  },
  "How much could we save by switching the Aluminum Sheet supplier?": {
    answer: "Switching the Aluminum Sheet (SKU-ALU-004) order to Global Metals Inc. could save approximately $4,500.",
    reasoning: "Global Metals Inc. is offering a promotional rate of $42.75 per unit compared to AluForge Partners' $45.00. However, their historical lead time is 3 days longer, which must be factored into production planning.",
    citations: [
      { source: "Market Rate Aggregator", snippet: "Global Metals Inc. Q3 promo: Aluminum 5mm sheet at $42.75/unit." },
      { source: "Supplier Lead Time Analysis", snippet: "Global Metals Inc. average lead time: 14 days (vs 11 days industry avg)." }
    ]
  },
  "Are there any excess inventory risks this quarter?": {
    answer: "Yes, we are currently holding excess inventory of Silicon Wafers (SKU-SIL-009) with a surplus value of roughly $120,000.",
    reasoning: "Demand forecasts for Silicon Wafers were adjusted down by 15% following a delayed product launch. Consequently, our current stock of 8,000 units significantly exceeds the revised 90-day forecast.",
    citations: [
      { source: "Sales Forecast Update", snippet: "Project X delayed to Q1 next year, reducing immediate silicon wafer dependency." },
      { source: "Inventory Capital Report", snippet: "SKU-SIL-009 identified as top contributor to excess holding costs." }
    ]
  }
};

export const MOCK_SUPPLIER_RISKS: SupplierRiskItem[] = [
  {
    supplier_id: "SUP-003",
    supplier_name: "Pacific MicroTech Logistics",
    risk_score: 0.745,
    label: "red",
    anomaly_rate: 0.284,
    weekend_rate: 0.320,
    avg_amount: 14650.00,
    n_rows: 142,
  },
  {
    supplier_id: "SUP-007",
    supplier_name: "Apex Global Semi & Cells",
    risk_score: 0.628,
    label: "red",
    anomaly_rate: 0.215,
    weekend_rate: 0.280,
    avg_amount: 12800.50,
    n_rows: 98,
  },
  {
    supplier_id: "SUP-001",
    supplier_name: "Nordic Raw Materials AS",
    risk_score: 0.462,
    label: "yellow",
    anomaly_rate: 0.125,
    weekend_rate: 0.140,
    avg_amount: 8920.00,
    n_rows: 215,
  },
  {
    supplier_id: "SUP-006",
    supplier_name: "Titan Wire & Cable Ltd",
    risk_score: 0.385,
    label: "yellow",
    anomaly_rate: 0.089,
    weekend_rate: 0.110,
    avg_amount: 7450.00,
    n_rows: 160,
  },
  {
    supplier_id: "SUP-004",
    supplier_name: "AluForge Heavy Fabrication",
    risk_score: 0.220,
    label: "green",
    anomaly_rate: 0.032,
    weekend_rate: 0.050,
    avg_amount: 5120.00,
    n_rows: 310,
  },
  {
    supplier_id: "SUP-002",
    supplier_name: "EuroPolymers Synth Group",
    risk_score: 0.145,
    label: "green",
    anomaly_rate: 0.015,
    weekend_rate: 0.020,
    avg_amount: 3890.00,
    n_rows: 280,
  }
];

export const MOCK_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: "aud-001",
    timestamp: "2 mins ago",
    action: "Approved Purchase Order PO-LITH-007 ($125,000)",
    actor: "Procurement Officer",
    actorType: "human",
    target: "PO-LITH-007",
    details: "Manual review cleared following inventory buffer verification.",
    status: "success",
  },
  {
    id: "aud-002",
    timestamp: "18 mins ago",
    action: "Auto-Generated Purchase Order PO-AUTO-COP-006",
    actor: "Decision Engine",
    actorType: "automated",
    target: "SKU-COP-006",
    details: "Projected 3-day stockout threshold breached. Ordered 5,500 units from Titan Wire.",
    status: "info",
  },
  {
    id: "aud-003",
    timestamp: "45 mins ago",
    action: "Extracted Supplier Delay Notice via Email",
    actor: "Gemini-LLM",
    actorType: "automated",
    target: "WireCo Delay Notice",
    details: "Identified 7-day shipment lag on Copper Wire; refreshed risk scores across tier-1 stores.",
    status: "warning",
  },
  {
    id: "aud-004",
    timestamp: "1 hour ago",
    action: "Decayed Trust Score for Pacific MicroTech (SUP-003)",
    actor: "system",
    actorType: "automated",
    target: "SUP-003",
    details: "Consecutive anomalous order quantity flagged by Enriched Anomaly Engine.",
    status: "warning",
  },
  {
    id: "aud-005",
    timestamp: "2 hours ago",
    action: "Simulated Supply Chain Disruption Scenario",
    actor: "Procurement Officer",
    actorType: "human",
    target: "Scenario #104 (25% Lead Time Shock)",
    details: "Modelled 3 SKU stockout impacts with total shortage cost of $42,500.",
    status: "info",
  },
  {
    id: "aud-006",
    timestamp: "3 hours ago",
    action: "Retrained XGBoost Demand Model on Uploaded Dataset",
    actor: "system",
    actorType: "automated",
    target: "Model Checkpoint v2.4",
    details: "Updated across 15 SKU demand distributions with RMSE of 4.12.",
    status: "success",
  },
];
