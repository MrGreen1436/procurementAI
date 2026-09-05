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

# Global mutable dicts / lists for in-memory state
MOCK_INVENTORY: dict[str, InventoryItem] = {}
MOCK_SUPPLIERS: dict[str, list[Supplier]] = {}
MOCK_POS: dict[str, PurchaseOrder] = {}
RISK_ALERTS: list[RiskAlert] = []   # populated by load_state_from_db(); empty list is safe default

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

        if 'price' not in df.columns:
            df['price'] = 100.0
        else:
            df['price'] = pd.to_numeric(df['price'], errors='coerce').fillna(100.0)

        if 'demand' not in df.columns:
            df['demand'] = 50.0
        else:
            df['demand'] = pd.to_numeric(df['demand'], errors='coerce').fillna(0.0)

        for sku in unique_skus:
            sku_df = df[df['sku_id'] == sku]
            avg_daily_demand = float(sku_df['demand'].mean()) if not sku_df.empty else 10.0
            if pd.isna(avg_daily_demand) or avg_daily_demand <= 0:
                avg_daily_demand = 10.0

            avg_price = float(sku_df['price'].mean()) if not sku_df.empty else 100.0
            if pd.isna(avg_price) or avg_price <= 0:
                avg_price = 100.0

            # current_stock = last 7 days average demand (proxy for current warehouse level)
            last_7 = sku_df.tail(7)['demand'].sum()
            current_stock = max(1, int(last_7)) if not pd.isna(last_7) else 50

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
            std_demand = sku_df['demand'].std() if len(sku_df) > 1 else 0
            if pd.isna(std_demand):
                std_demand = 0
            reliability = round(max(0.70, min(0.99, 1.0 - (std_demand / (avg_daily_demand + 1)) * 0.1)), 2)
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

def load_state_from_db():
    """
    Populate MOCK_INVENTORY, MOCK_SUPPLIERS, and dynamic RISK_ALERTS
    directly from the SQL database (procurement.db).
    """
    global MOCK_INVENTORY, MOCK_SUPPLIERS, RISK_ALERTS
    try:
        from database import db_get_sku_state_map, db_seed_if_empty
        db_seed_if_empty()
        sku_map = db_get_sku_state_map()
        if not sku_map:
            load_state_from_csv()
            return

        MOCK_INVENTORY.clear()
        MOCK_SUPPLIERS.clear()
        MOCK_POS.clear()
        dynamic_alerts = []

        for sku, info in sku_map.items():
            current_stock = info["current_stock"]
            reorder_point = info["reorder_point"]
            avg_price     = info["avg_price"]
            site_id       = info["site_id"]
            supplier_name = info["supplier_name"]

            MOCK_INVENTORY[sku] = InventoryItem(
                sku_id=sku,
                site_id=site_id,
                current_stock=current_stock,
                reorder_point=reorder_point,
                reorder_level=reorder_point,
            )

            # Generate dynamic suppliers from database
            sup_id = f"SUP-{abs(hash(sku)) % 90 + 10:02d}"
            sup_backup_id = f"SUP-{abs(hash(sku + 'B')) % 90 + 10:02d}"
            MOCK_SUPPLIERS[sku] = [
                Supplier(
                    supplier_id=sup_id,
                    name=supplier_name or f"Primary Supplier ({sku})",
                    unit_price=round(avg_price * 0.95, 2),
                    lead_time_days=10,
                    reliability_score=0.92,
                ),
                Supplier(
                    supplier_id=sup_backup_id,
                    name=f"Secondary Supplier ({sku})",
                    unit_price=round(avg_price * 1.05, 2),
                    lead_time_days=16,
                    reliability_score=0.82,
                ),
            ]

            # Dynamic risk alert if stock is below or near reorder point
            if current_stock <= reorder_point:
                daily_d = info.get("avg_daily_demand", 10.0)
                days_left = max(1, int(current_stock / daily_d)) if daily_d > 0 else 5
                risk_lvl = "high" if days_left <= 7 else "medium"
                dynamic_alerts.append(
                    RiskAlert(
                        alert_id=f"ALERT-DB-{sku}",
                        sku_id=sku,
                        site_id=site_id,
                        risk_level=risk_lvl,
                        reason=f"Current stock ({current_stock}) below reorder point ({reorder_point}) based on live database records.",
                        predicted_stockout_date=date.today() + timedelta(days=days_left),
                    )
                )

        if dynamic_alerts:
            RISK_ALERTS = dynamic_alerts
        print(f"Loaded {len(MOCK_INVENTORY)} SKUs directly from database into store.py")
    except Exception as e:
        print(f"Failed to load state from DB: {e}, falling back to CSV")
        load_state_from_csv()


# Call it once on startup (database primary)
try:
    load_state_from_db()
except Exception:
    load_state_from_csv()

# ---------------------------------------------------------------
# Risk Alerts — initialized above from database dynamically
# ---------------------------------------------------------------
if not RISK_ALERTS:
    RISK_ALERTS: list[RiskAlert] = [
        RiskAlert(
            alert_id="ALERT-001",
            sku_id="SKU-001",
            site_id="SITE-A",
            risk_level="high",
            reason="Current stock below reorder point",
            predicted_stockout_date=date.today() + timedelta(days=9),
        ),
    ]

# ---------------------------------------------------------------
# Supplier Outreach state (from shashi — tracks live call status)
# ---------------------------------------------------------------
SUPPLIER_OUTREACH_DATA: dict = {}
