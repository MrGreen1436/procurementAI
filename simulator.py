"""
simulator.py ΓÇö What-If Scenario Simulation Engine for ProcurementAI.

Simulates supply chain disruptions, supplier lead-time shifts, and demand surges
to project inventory shortages, financial impact, and mitigation recommendations.
"""

import os
from pathlib import Path
from typing import Optional
import pandas as pd
import numpy as np

# =====================================================
# DATASET LOADING
# =====================================================

def _get_active_df() -> pd.DataFrame:
    base_dir = Path(__file__).parent
    uploaded = base_dir / "uploaded_dataset.csv"
    default = base_dir / "demand_sample.csv"
    if uploaded.exists():
        df = pd.read_csv(uploaded)
        df["date"] = pd.to_datetime(df["date"])
        return df
    elif default.exists():
        df = pd.read_csv(default)
        df["date"] = pd.to_datetime(df["date"])
        return df

    # Fallback to database
    try:
        from database import db_get_sku_state_map
        sku_map = db_get_sku_state_map()
        if sku_map:
            rows = []
            for sku, info in sku_map.items():
                daily_d = info.get("avg_daily_demand", 10.0)
                price = info.get("avg_price", 50.0)
                rows.append({"sku_id": sku, "demand": daily_d, "price": price, "date": "2026-01-01"})
            df = pd.DataFrame(rows)
            df["date"] = pd.to_datetime(df["date"])
            return df
    except Exception:
        pass

    rows = [{"sku_id": f"P{i:04d}", "demand": 20.0, "price": 50.0, "date": "2026-01-01"} for i in range(1, 21)]
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    return df


BASELINE_LEAD_TIME_DAYS = 5
BASELINE_INVENTORY_DAYS = 5
SAFETY_STOCK_FACTOR = 1.0


# =====================================================
# WHAT-IF SIMULATOR ENGINE
# =====================================================

def run_what_if_simulation(
    lead_time_variability_pct: float = 0.0,
    demand_increase_pct: float = 0.0,
    disrupted_supplier_id: Optional[str] = None,
    extra_delay_days: Optional[int] = None,
) -> dict:
    """
    Simulates inventory resilience under demand spikes and lead-time shocks.

    Parameters:
      - lead_time_variability_pct: e.g. +20% for 20% supplier delay, -10% for speedup.
      - demand_increase_pct: e.g. +30% for 30% demand surge.
      - disrupted_supplier_id: optional ID of a single supplier suffering outage.
      - extra_delay_days: optional fixed additional delay days for disrupted supplier.

    Returns:
      dict matching ScenarioResult with enriched skuDetails.
    """
    df = _get_active_df()

    # Supplier delays are durable facts, not merely in-process UI state.  Read
    # the latest persisted delay for each SKU so a scenario still reflects an
    # ingested email after a backend restart.
    try:
        from database import db_get_latest_delay_days_by_sku
        persisted_delay_days = db_get_latest_delay_days_by_sku()
    except Exception:
        persisted_delay_days = {}

    # Try importing current live inventory state if available
    live_inventory = {}
    live_suppliers = {}
    try:
        from store import MOCK_INVENTORY, MOCK_SUPPLIERS
        live_inventory = MOCK_INVENTORY
        live_suppliers = MOCK_SUPPLIERS
    except Exception:
        pass

    affected_skus = []
    sku_details = []
    total_cost = 0.0
    total_shortage_units = 0.0

    # Base lead time adjusted by scenario percentage
    base_adjusted_lead_time = BASELINE_LEAD_TIME_DAYS * (1.0 + lead_time_variability_pct / 100.0)
    demand_multiplier = max(0.01, 1.0 + demand_increase_pct / 100.0)

    unique_skus = df["sku_id"].unique()

    for sku in unique_skus:
        sku_data = df[df["sku_id"] == sku]
        average_daily_demand = float(sku_data["demand"].mean()) if not sku_data.empty else 10.0
        demand_std = float(sku_data["demand"].std()) if not sku_data.empty and not np.isnan(sku_data["demand"].std()) else 2.5
        average_price = float(sku_data["price"].mean()) if not sku_data.empty else 50.0

        # Check if this SKU's supplier is specifically disrupted
        sku_lead_time = base_adjusted_lead_time + persisted_delay_days.get(str(sku), 0)
        sku_suppliers = live_suppliers.get(sku, [])
        is_supplier_disrupted = False

        if disrupted_supplier_id and sku_suppliers:
            for s in sku_suppliers:
                if s.supplier_id == disrupted_supplier_id:
                    is_supplier_disrupted = True
                    break

        if is_supplier_disrupted and extra_delay_days:
            sku_lead_time += extra_delay_days

        # Inventory baseline (use live stock if in store, else historical calculation)
        if sku in live_inventory:
            estimated_inventory = float(live_inventory[sku].current_stock)
        else:
            normal_inventory = average_daily_demand * BASELINE_INVENTORY_DAYS
            safety_stock = SAFETY_STOCK_FACTOR * demand_std * np.sqrt(max(1.0, BASELINE_LEAD_TIME_DAYS))
            estimated_inventory = normal_inventory + safety_stock

        # Scenario demand over the lead time period
        scenario_daily_demand = average_daily_demand * demand_multiplier
        demand_during_delay = scenario_daily_demand * max(1.0, sku_lead_time)

        # Net balance
        remaining_inventory = round(estimated_inventory - demand_during_delay, 1)
        shortage = max(0.0, -remaining_inventory)

        action = "Stock levels healthy under scenario."
        if shortage > 0:
            affected_skus.append(sku)
            shortage_cost = round(shortage * average_price, 2)
            total_cost += shortage_cost
            total_shortage_units += shortage

            # Recommend mitigation
            backup = None
            if sku_suppliers and len(sku_suppliers) > 1:
                backup = sku_suppliers[1]

            if backup:
                action = f"Critical: Stockout risk! Expedite {int(shortage + 10)} units from backup {backup.name} (${backup.unit_price}/unit)."
            else:
                action = f"Urgent: Pre-order {int(shortage + 15)} units or advance supplier reorder schedule by {int(sku_lead_time / 2)} days."
        elif remaining_inventory < (estimated_inventory * 0.25):
            action = "Warning: Buffer stock depleted to under 25%. Monitor replenishment."

        sku_details.append({
            "sku_id": str(sku),
            "baseline_inventory": round(estimated_inventory, 1),
            "scenario_demand": round(demand_during_delay, 1),
            "remaining_inventory": remaining_inventory,
            "shortage_units": round(shortage, 1),
            "shortage_cost": round(shortage * average_price, 2) if shortage > 0 else 0.0,
            "recommended_action": action,
        })

    # Sort details: highest shortage first
    sku_details.sort(key=lambda x: x["shortage_units"], reverse=True)

    return {
        "newStockoutCount": len(affected_skus),
        "costImpact": round(total_cost, 2),
        "affectedSkus": affected_skus,
        "totalShortageUnits": round(total_shortage_units, 1),
        "skuDetails": sku_details,
    }


def simulate(lead_time_variability_pct: float, demand_increase_pct: float) -> dict:
    """Convenience wrapper for backward compatibility."""
    return run_what_if_simulation(
        lead_time_variability_pct=lead_time_variability_pct,
        demand_increase_pct=demand_increase_pct,
    )


# =====================================================
# DIRECT CLI TEST
# =====================================================

if __name__ == "__main__":
    result = simulate(lead_time_variability_pct=20, demand_increase_pct=30)
    print("What-if Simulation Result:")
    print(f"Stockout Count: {result['newStockoutCount']}")
    print(f"Cost Impact: ${result['costImpact']:,.2f}")
    print(f"Affected SKUs: {result['affectedSkus']}")
    print(f"Total Shortage Units: {result['totalShortageUnits']}")
