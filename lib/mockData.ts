import { Alert, InventoryPoint, KPISummary, PurchaseOrder, QueryResponse } from "../types";

// Real SKU IDs that match what demand_sample.csv + store.py produce at runtime
export const SKUS = [
  { sku: "SKU_001", name: "Product SKU_001" },
  { sku: "SKU_002", name: "Product SKU_002" },
  { sku: "SKU_003", name: "Product SKU_003" },
  { sku: "SKU_004", name: "Product SKU_004" },
  { sku: "SKU_005", name: "Product SKU_005" },
  { sku: "SKU_006", name: "Product SKU_006" },
  { sku: "SKU_007", name: "Product SKU_007" },
  { sku: "P0001", name: "Product P0001 (Groceries)" },
  { sku: "P0002", name: "Product P0002 (Toys)" },
  { sku: "P0003", name: "Product P0003 (Toys)" },
  { sku: "P0004", name: "Product P0004 (Toys)" },
  { sku: "P0005", name: "Product P0005 (Groceries)" },
  { sku: "P0006", name: "Product P0006 (Clothing)" },
  { sku: "P0007", name: "Product P0007 (Electronics)" },
  { sku: "P0008", name: "Product P0008 (Groceries)" },
  { sku: "P0009", name: "Product P0009 (Clothing)" },
  { sku: "P0010", name: "Product P0010 (Toys)" },
  { sku: "P0011", name: "Product P0011 (Clothing)" },
  { sku: "P0012", name: "Product P0012 (Electronics)" },
  { sku: "P0013", name: "Product P0013 (Groceries)" },
  { sku: "P0014", name: "Product P0014 (Toys)" },
  { sku: "P0015", name: "Product P0015 (Clothing)" },
  { sku: "P0016", name: "Product P0016 (Toys)" },
  { sku: "P0017", name: "Product P0017 (Toys)" },
  { sku: "P0018", name: "Product P0018 (Clothing)" },
  { sku: "P0019", name: "Product P0019 (Toys)" },
  { sku: "P0020", name: "Product P0020 (Groceries)" },
];

export const MOCK_KPIS: KPISummary = {
  stockoutRiskCount: 6,
  excessInventoryValue: 1245000,
  openPOCount: 5,
  supplierRiskScore: 68,
};

export const MOCK_ALERTS: Alert[] = [
  {
    id: "alt-1",
    sku: "SKU_001",
    skuName: "Product SKU_001",
    riskLevel: "high",
    daysUntilStockout: 4,
    currentStock: 1200,
    forecastedDemand: 3500,
    createdAt: new Date().toISOString(),
  },
  {
    id: "alt-2",
    sku: "SKU_002",
    skuName: "Product SKU_002",
    riskLevel: "high",
    daysUntilStockout: 2,
    currentStock: 450,
    forecastedDemand: 2100,
    createdAt: new Date().toISOString(),
  },
  {
    id: "alt-3",
    sku: "SKU_003",
    skuName: "Product SKU_003",
    riskLevel: "medium",
    daysUntilStockout: 12,
    currentStock: 8000,
    forecastedDemand: 12000,
    createdAt: new Date().toISOString(),
  },
  {
    id: "alt-4",
    sku: "SKU_004",
    skuName: "Product SKU_004",
    riskLevel: "low",
    daysUntilStockout: 45,
    currentStock: 50000,
    forecastedDemand: 25000,
    createdAt: new Date().toISOString(),
  },
  {
    id: "alt-5",
    sku: "SKU_005",
    skuName: "Product SKU_005",
    riskLevel: "medium",
    daysUntilStockout: 18,
    currentStock: 1500,
    forecastedDemand: 3200,
    createdAt: new Date().toISOString(),
  },
  {
    id: "alt-6",
    sku: "SKU_006",
    skuName: "Product SKU_006",
    riskLevel: "high",
    daysUntilStockout: 6,
    currentStock: 2500,
    forecastedDemand: 8000,
    createdAt: new Date().toISOString(),
  },
];

export const MOCK_POS: PurchaseOrder[] = [
  {
    id: "po-101",
    sku: "SKU_001",
    skuName: "Product SKU_001",
    supplier: "Primary Supplier (SKU_001)",
    quantity: 10000,
    unitCost: 12.5,
    totalCost: 125000,
    riskLevel: "high",
    status: "pending",
    agentExplanation: {
      whySupplier:
        "Primary Supplier (SKU_001) has the shortest lead time (14 days), mitigating the immediate stockout risk.",
      whyQuantity:
        "10,000 units covers the projected 30-day demand deficit and provides a 15% safety buffer.",
      whyCost:
        "$12.50 reflects the average market price for this SKU from the enriched dataset.",
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: "po-102",
    sku: "SKU_002",
    skuName: "Product SKU_002",
    supplier: "Primary Supplier (SKU_002)",
    quantity: 5000,
    unitCost: 8.2,
    totalCost: 41000,
    riskLevel: "high",
    status: "pending",
    agentExplanation: {
      whySupplier: "Primary supplier has available stock and competitive pricing.",
      whyQuantity: "Matches exactly the shortfall for the upcoming 2 weeks.",
      whyCost: "Standard negotiated rate applies.",
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: "po-103",
    sku: "SKU_003",
    skuName: "Product SKU_003",
    supplier: "Backup Supplier (SKU_003)",
    quantity: 500,
    unitCost: 45.0,
    totalCost: 22500,
    riskLevel: "medium",
    status: "pending",
    agentExplanation: {
      whySupplier: "Strategic partner with lowest bulk pricing for this category.",
      whyQuantity: "Fulfilling quarterly forecast requirements.",
      whyCost: "Volume discount applied (-5%).",
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: "po-104",
    sku: "SKU_004",
    skuName: "Product SKU_004",
    supplier: "Primary Supplier (SKU_004)",
    quantity: 8000,
    unitCost: 2.1,
    totalCost: 16800,
    riskLevel: "medium",
    status: "pending",
    agentExplanation: {
      whySupplier: "Offers the most reliable delivery windows for this product category.",
      whyQuantity: "Aligns with expected production ramp-up for next quarter.",
      whyCost: "Locked in at previous quarter rates, avoiding recent 3% market spike.",
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: "po-105",
    sku: "SKU_005",
    skuName: "Product SKU_005",
    supplier: "Primary Supplier (SKU_005)",
    quantity: 2000,
    unitCost: 45.0,
    totalCost: 90000,
    riskLevel: "low",
    status: "pending",
    agentExplanation: {
      whySupplier: "Preferred supplier for this product line with high reliability score.",
      whyQuantity: "Standard replenishment cycle order.",
      whyCost: "Within 2% of our targeted unit cost baseline.",
    },
    createdAt: new Date().toISOString(),
  },
];

// Generate 60 days of history for each real SKU
export const generateInventoryHistory = (): InventoryPoint[] => {
  const points: InventoryPoint[] = [];
  const today = new Date();

  SKUS.forEach((skuObj) => {
    let currentActual = 1000 + Math.random() * 9000;

    for (let i = 60; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);

      const dateStr = d.toISOString().split("T")[0];

      // Add some random noise
      currentActual = Math.max(0, currentActual + (Math.random() * 400 - 200));

      // Forecast is usually close to actual in the past, maybe slightly off
      const forecasted = Math.max(0, currentActual + (Math.random() * 200 - 100));

      points.push({
        date: dateStr,
        sku: skuObj.sku,
        actualLevel: Math.round(currentActual),
        forecastedLevel: Math.round(forecasted),
      });
    }
  });

  return points;
};

export const MOCK_INVENTORY_HISTORY = generateInventoryHistory();

export const MOCK_QA_PAIRS: Record<string, QueryResponse> = {
  "Which SKUs are at highest stockout risk?": {
    answer:
      "Based on current forecasting, SKU_001 and SKU_002 are at the highest risk of stockout within the next 4–7 days.",
    reasoning:
      "The ML model predicts a stockout in 4 days for SKU_001 due to a sudden 35% surge in forecasted demand, while current stock is critically low. SKU_002 has a supplier delay combined with steady demand, pushing stockout risk to 2 days.",
    citations: [
      { source: "Inventory Forecast Model v2", snippet: "SKU_001 predicted depletion: 96 hours." },
      {
        source: "Supplier Risk Alert",
        snippet: "Primary Supplier (SKU_002) reports 5-day delay on shipments.",
      },
    ],
  },
  "Why did we order more stock this month?": {
    answer:
      "We increased order volume for SKU_004 because the predictive pricing model expects a 12% cost increase next quarter due to raw material shortages.",
    reasoning:
      "Agent analysis shows that carrying costs for the excess inventory are lower than the projected price hike. By buying now, we optimize total expenditure while securing supply for upcoming peak production.",
    citations: [
      {
        source: "Commodity Price Forecast",
        snippet: "Input materials expected to rise 10-15% in Q4.",
      },
      {
        source: "Cost Optimization Agent",
        snippet: "Recommended early bulk purchase of SKU_004; estimated saving $14,000.",
      },
    ],
  },
  "What is the current risk level for our primary supplier?": {
    answer:
      "The primary supplier for SKU_002 currently has a high risk score due to recent delivery delays.",
    reasoning:
      "Our supplier monitoring system flagged a 5-day average delay over their last 3 shipments. The trust score has dropped to 0.71 following the mismatch count penalty.",
    citations: [
      {
        source: "Supplier Trust Score Engine",
        snippet: "Avg delay for Primary Supplier (SKU_002) (last 30 days): +5.2 days.",
      },
    ],
  },
  "How much could we save by switching the supplier?": {
    answer:
      "Switching SKU_005 to the backup supplier could save approximately $4,500 at current order volumes.",
    reasoning:
      "Backup Supplier (SKU_005) is offering a promotional rate 5% below the primary supplier. However, their historical lead time is 7 days longer, which must be factored into production planning.",
    citations: [
      {
        source: "Market Rate Aggregator",
        snippet: "Backup Supplier (SKU_005) current rate is 5% below primary supplier.",
      },
    ],
  },
  "Are there any excess inventory risks this quarter?": {
    answer:
      "Yes, we are currently holding excess inventory of SKU_005 with a surplus value of roughly $90,000.",
    reasoning:
      "Demand forecasts for SKU_005 were adjusted down by 15% following a delayed product launch. Consequently, our current stock significantly exceeds the revised 90-day forecast.",
    citations: [
      {
        source: "Sales Forecast Update",
        snippet: "Project delayed to Q1 next year, reducing immediate SKU_005 dependency.",
      },
      {
        source: "Inventory Capital Report",
        snippet: "SKU_005 identified as top contributor to excess holding costs.",
      },
    ],
  },
};
