"""
store.py — Shared in-memory state for the Procurement AI backend.
Both main.py and agent_tools.py import from here, avoiding circular imports.
Task 5 (database.py) will replace these dicts with SQLAlchemy queries.
"""
from datetime import date, timedelta
from models import InventoryItem, Supplier, RiskAlert, PurchaseOrder
import pandas as pd
import io
import random
import os

# Global mutable dicts for in-memory state
MOCK_INVENTORY: dict[str, InventoryItem] = {}
MOCK_SUPPLIERS: dict[str, list[Supplier]] = {}
MOCK_POS: dict[str, PurchaseOrder] = {}

# ---------------------------------------------------------------
# Supplier Outreach extended data (Step 2 — Supplier Outreach)
# Keyed by supplier_id. Stores mutable outreach call results
# alongside the immutable Pydantic Supplier objects.
# Fields:
#   phone          — contact phone number (string)
#   last_price     — last quoted unit price from simulate_supplier_call (float | None)
#   last_checked   — ISO timestamp of the last simulated call (str | None)
#   last_lead_time — last quoted lead time in days (int | None)
# ---------------------------------------------------------------
SUPPLIER_OUTREACH_DATA: dict[str, dict] = {}

def load_state_from_csv(csv_path: str = "demand_sample.csv"):
    """
    Reads the dataset and populates MOCK_INVENTORY and MOCK_SUPPLIERS
    dynamically based on the unique SKUs found in the file.
    """
    global MOCK_INVENTORY, MOCK_SUPPLIERS
    
    try:
        # Read into memory immediately and close the file handle (avoids Windows file lock)
        with open(csv_path, 'r', encoding='utf-8') as f:
            data = f.read()
        df = pd.read_csv(io.StringIO(data))

        date_col = next((c for c in ["date", "Date", "DATE"] if c in df.columns), None)
        sku_col = next((c for c in ["sku_id", "Product ID", "product_id", "SKU", "sku"] if c in df.columns), None)
        demand_col = next((c for c in ["demand", "Units Sold", "units_sold", "Units Ordered"] if c in df.columns), None)
        price_col = next((c for c in ["price", "Price", "last_known_price"] if c in df.columns), None)

        if not (sku_col and demand_col):
            raise ValueError(f"Missing required columns in {csv_path}")

        if date_col:
            df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
            df = df.dropna(subset=[date_col])
            df = df.sort_values(date_col)

        unique_skus = df[sku_col].dropna().unique()
        if len(unique_skus) == 0:
            raise ValueError("No SKUs found in dataset")

        MOCK_INVENTORY.clear()
        MOCK_SUPPLIERS.clear()

        for sku in unique_skus:
            sku_df = df[df[sku_col] == sku]
            avg_daily_demand = float(sku_df[demand_col].mean()) if not sku_df[demand_col].empty else 50.0
            avg_price = float(sku_df[price_col].mean()) if price_col and not sku_df[price_col].empty else 100.0

            # current_stock = last 7 records demand sum (proxy for current warehouse level)
            last_7 = sku_df.tail(7)[demand_col].sum()
            current_stock = max(1, int(last_7))

            # reorder_point = 14-day demand (order when you have 2 weeks of stock left)
            reorder_point = max(1, int(avg_daily_demand * 14))

            sku_str = str(sku)
            MOCK_INVENTORY[sku_str] = InventoryItem(
                sku_id=sku_str,
                site_id="SITE-DYNAMIC",
                current_stock=current_stock,
                reorder_point=reorder_point,
            )

            # Supplier data: use real avg price from CSV, sensible lead times
            lead_time_days = 14
            demand_std = float(sku_df[demand_col].std()) if len(sku_df) > 1 else 10.0
            reliability = round(max(0.70, min(0.99, 1.0 - (demand_std / (avg_daily_demand + 1)) * 0.1)), 2)
            primary_id = f"SUP-{abs(hash(sku_str)) % 90 + 10}"
            backup_id  = f"SUP-{abs(hash(sku_str + 'B')) % 90 + 10}"

            # Check if dataset has actual supplier info for this SKU
            if "supplier_id" in df.columns:
                sup_rows = sku_df.dropna(subset=["supplier_id"])
                if not sup_rows.empty:
                    primary_id = str(sup_rows.iloc[0]["supplier_id"])
                    if "lead_time_days" in df.columns:
                        try:
                            lead_time_days = int(sup_rows.iloc[0]["lead_time_days"])
                        except Exception:
                            pass

            MOCK_SUPPLIERS[sku_str] = [
                Supplier(
                    supplier_id=primary_id,
                    name=f"Primary Supplier ({sku_str})",
                    unit_price=round(avg_price * 0.95, 2),
                    lead_time_days=lead_time_days,
                    reliability_score=reliability,
                ),
                Supplier(
                    supplier_id=backup_id,
                    name=f"Backup Supplier ({sku_str})",
                    unit_price=round(avg_price * 1.05, 2),
                    lead_time_days=lead_time_days + 7,
                    reliability_score=round(max(0.60, reliability - 0.10), 2),
                ),
            ]

            SUPPLIER_OUTREACH_DATA[primary_id] = {
                "name":           f"Primary Supplier ({sku_str})",
                "phone":          f"+1-800-{abs(hash(sku_str)) % 9000 + 1000}",
                "last_price":     None,
                "last_checked":   None,
                "last_lead_time": None,
            }
            SUPPLIER_OUTREACH_DATA[backup_id] = {
                "name":           f"Backup Supplier ({sku_str})",
                "phone":          f"+1-800-{abs(hash(sku_str + 'B')) % 9000 + 1000}",
                "last_price":     None,
                "last_checked":   None,
                "last_lead_time": None,
            }

        print(f"Loaded {len(unique_skus)} SKUs dynamically into store.py")
    except Exception as e:
        print(f"Failed to load state from CSV: {e}")

# Call it once on startup
load_state_from_csv()

# ---------------------------------------------------------------
# Risk Alerts — dynamically built from real inventory after CSV load
# This ensures SKU IDs always match MOCK_INVENTORY keys.
# ---------------------------------------------------------------
def _build_risk_alerts() -> list:
    """Generate RISK_ALERTS from actual inventory state after CSV load."""
    from datetime import date, timedelta
    alerts = []
    alert_num = 1
    for sku_id, item in MOCK_INVENTORY.items():
        stock = item.current_stock
        reorder = item.reorder_point
        if stock <= reorder:
            days_left = max(1, int(stock / max(reorder / 14, 1)))
            if stock <= reorder * 0.5:
                risk = "high"
                days_until = min(days_left, 7)
            elif stock <= reorder:
                risk = "high"
                days_until = min(days_left, 14)
            else:
                risk = "medium"
                days_until = days_left
            alerts.append(RiskAlert(
                alert_id=f"ALERT-{alert_num:03d}",
                sku_id=sku_id,
                site_id="SITE-DYNAMIC",
                risk_level=risk,
                reason=f"Current stock ({stock}) at or below reorder point ({reorder})",
                predicted_stockout_date=date.today() + timedelta(days=days_until),
            ))
            alert_num += 1
    return alerts


RISK_ALERTS: list[RiskAlert] = _build_risk_alerts()
print(f"Generated {len(RISK_ALERTS)} risk alerts from inventory")
