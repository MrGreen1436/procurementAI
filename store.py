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

def load_state_from_csv(csv_path: str = "demand_sample.csv"):
    """
    Reads the dataset and populates MOCK_INVENTORY and MOCK_SUPPLIERS
    dynamically based on the unique SKUs found in the file.
    """
    global MOCK_INVENTORY, MOCK_SUPPLIERS
    MOCK_INVENTORY.clear()
    MOCK_SUPPLIERS.clear()
    
    try:
        # Read into memory immediately and close the file handle (avoids Windows file lock)
        with open(csv_path, 'r', encoding='utf-8') as f:
            data = f.read()
        df = pd.read_csv(io.StringIO(data))
        df['date'] = pd.to_datetime(df['date'])
        df = df.sort_values('date')
        unique_skus = df['sku_id'].unique()

        for sku in unique_skus:
            sku_df = df[df['sku_id'] == sku]
            avg_daily_demand = float(sku_df['demand'].mean())
            avg_price        = float(sku_df['price'].mean())

            # current_stock = last 7 days average demand (proxy for current warehouse level)
            last_7 = sku_df.tail(7)['demand'].sum()
            current_stock = max(1, int(last_7))

            # reorder_point = 14-day demand (order when you have 2 weeks of stock left)
            reorder_point = max(1, int(avg_daily_demand * 14))

            MOCK_INVENTORY[sku] = InventoryItem(
                sku_id=sku,
                site_id="SITE-DYNAMIC",
                current_stock=current_stock,
                reorder_point=reorder_point,
            )

            # Supplier data: use real avg price from CSV, sensible lead times
            lead_time_days = 14
            reliability = round(max(0.70, min(0.99, 1.0 - (sku_df['demand'].std() / (avg_daily_demand + 1)) * 0.1)), 2)
            MOCK_SUPPLIERS[sku] = [
                Supplier(
                    supplier_id=f"SUP-{abs(hash(sku)) % 90 + 10}",
                    name=f"Primary Supplier ({sku})",
                    unit_price=round(avg_price * 0.95, 2),
                    lead_time_days=lead_time_days,
                    reliability_score=reliability,
                ),
                Supplier(
                    supplier_id=f"SUP-{abs(hash(sku + 'B')) % 90 + 10}",
                    name=f"Backup Supplier ({sku})",
                    unit_price=round(avg_price * 1.05, 2),
                    lead_time_days=lead_time_days + 7,
                    reliability_score=round(max(0.60, reliability - 0.10), 2),
                ),
            ]

        print(f"Loaded {len(unique_skus)} SKUs dynamically into store.py")
    except Exception as e:
        print(f"Failed to load state from CSV: {e}")

# Call it once on startup
load_state_from_csv()

# ---------------------------------------------------------------
# Risk Alerts — static seed; updated by email parser (Task 4)
# ---------------------------------------------------------------
RISK_ALERTS: list[RiskAlert] = [
    RiskAlert(
        alert_id="ALERT-001",
        sku_id="SKU-001",
        site_id="SITE-A",
        risk_level="high",
        reason="Current stock (120) below reorder point (200); forecast demand rising",
        predicted_stockout_date=date.today() + timedelta(days=9),
    ),
    RiskAlert(
        alert_id="ALERT-002",
        sku_id="SKU-003",
        site_id="SITE-C",
        risk_level="high",
        reason="Current stock (30) critically below reorder point (100)",
        predicted_stockout_date=date.today() + timedelta(days=4),
    ),
]

# ---------------------------------------------------------------
# Supplier Outreach state (from shashi — tracks live call status)
# ---------------------------------------------------------------
SUPPLIER_OUTREACH_DATA: dict = {}
