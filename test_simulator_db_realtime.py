"""
test_simulator_db_realtime.py — Comprehensive test suite for:
1. Supplier delay email parser
2. What-if scenario simulator backend
3. Database persistence (SQLite/Postgres)
4. Real-time updates (WebSocket events)
"""

import sys
import json
import time
import asyncio
from datetime import date
from fastapi.testclient import TestClient

# Import main FastAPI application
try:
    from main import app, manager
    import database
    import simulator
    from store import MOCK_INVENTORY, MOCK_SUPPLIERS
except ImportError as e:
    print(f"Import error: {e}")
    sys.exit(1)

client = TestClient(app)

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
results = []

def record(name: str, passed: bool, detail: str = ""):
    status = PASS if passed else FAIL
    print(f"  [{status}] {name} {detail}")
    results.append(passed)

print("\n========== Testing Supplier Delay, Simulator, DB & Real-Time ==========\n")

# ---------------------------------------------------------------
# 1. Health & Database Init
# ---------------------------------------------------------------
print("1. Health & Database Initialization")
res = client.get("/health")
data = res.json()
record("GET /health status", res.status_code == 200, f"(status={data.get('status')})")
record("Database report in health", "database" in data, f"({data.get('database')})")

database.init_db()
tables = list(database.Base.metadata.tables.keys())
expected_tables = ["purchase_orders", "risk_alerts", "supplier_email_logs", "scenario_runs"]
all_tables_present = all(t in tables for t in expected_tables)
record("SQLAlchemy table creation", all_tables_present, f"Tables: {tables}")

# ---------------------------------------------------------------
# 2. What-If Simulator Backend Tests
# ---------------------------------------------------------------
print("\n2. What-If Simulator Backend")

# Direct simulator engine test
sim_out = simulator.run_what_if_simulation(lead_time_variability_pct=25.0, demand_increase_pct=30.0)
record(
    "Simulator direct engine run",
    "newStockoutCount" in sim_out and "costImpact" in sim_out and "affectedSkus" in sim_out,
    f"newStockouts={sim_out.get('newStockoutCount')}, costImpact=${sim_out.get('costImpact'):,.2f}"
)

# API Endpoint /scenario/run
scenario_payload = {
    "lead_time_variability_pct": 20.0,
    "demand_increase_pct": 35.0,
}
res = client.post("/scenario/run", json=scenario_payload)
record("POST /scenario/run HTTP 200", res.status_code == 200)
sc_data = res.json()
record("Scenario result has required fields", "newStockoutCount" in sc_data and "costImpact" in sc_data)

# API Endpoint /simulate (alias)
res_alias = client.post("/simulate", json=scenario_payload)
record("POST /simulate alias HTTP 200", res_alias.status_code == 200)

# Scenario history
res_hist = client.get("/scenario/history")
record("GET /scenario/history HTTP 200", res_hist.status_code == 200)
history_records = res_hist.json()
record("Scenario run persisted in DB", len(history_records) > 0, f"Saved runs count: {len(history_records)}")

# ---------------------------------------------------------------
# 3. Supplier Delay Email Parser Tests
# ---------------------------------------------------------------
print("\n3. Supplier Delay Email Parser")

sample_email = """
Dear Supply Chain Team,

Due to a customs inspection delay at the central distribution hub, shipment of SKU_001
from Beta Metals (SUP-02) under order ORD-7782 will be delayed by 8 days.

We are expediting transport once cleared.

Regards,
Beta Metals Shipping
"""

res_email = client.post("/email/parse", json={"raw_email_text": sample_email})
record("POST /email/parse HTTP 200", res_email.status_code == 200)
email_data = res_email.json()
record(
    "Extracted delay days",
    email_data.get("delay_days") == 8,
    f"Extracted delay_days={email_data.get('delay_days')}"
)
record(
    "Extracted SKU ID",
    "SKU" in str(email_data.get("sku_id")),
    f"Extracted sku_id={email_data.get('sku_id')}"
)
record(
    "Stockout risk alert triggered",
    email_data.get("stockout_risk_triggered") is True,
    f"alert_id={email_data.get('created_alert_id')}"
)

# Verify email logged in DB
res_email_hist = client.get("/email/history")
record("GET /email/history HTTP 200", res_email_hist.status_code == 200)
email_logs = res_email_hist.json()
record("Email parse logged to DB", len(email_logs) > 0, f"Logged count: {len(email_logs)}")

# ---------------------------------------------------------------
# 4. Database Persistence CRUD Tests
# ---------------------------------------------------------------
print("\n4. Database Persistence CRUD")

# Test saving and updating a PO in DB
test_po = {
    "po_id": "PO-TEST-9999",
    "supplier_id": "SUP-01",
    "items": [{"sku_id": "SKU_001", "quantity": 50, "unit_price": 95.0}],
    "total_cost": 4750.0,
    "reasoning": "Automated unit test PO",
    "status": "pending_approval",
    "generated_by": "fallback",
}
database.db_save_po(test_po)
pos_in_db = database.db_get_all_pos()
found_po = next((p for p in pos_in_db if p["po_id"] == "PO-TEST-9999"), None)
record("PO saved to SQLite DB", found_po is not None)

database.db_update_po_status("PO-TEST-9999", "auto_approved")
pos_in_db_updated = database.db_get_all_pos()
found_po_updated = next((p for p in pos_in_db_updated if p["po_id"] == "PO-TEST-9999"), None)
record("PO status updated in SQLite DB", found_po_updated and found_po_updated["status"] == "auto_approved")

# ---------------------------------------------------------------
# 5. Real-Time WebSocket Channel Tests
# ---------------------------------------------------------------
print("\n5. Real-Time WebSocket Channel")

with client.websocket_connect("/ws") as websocket:
    # Receive initial connection message
    welcome_msg = websocket.receive_text()
    welcome_data = json.loads(welcome_msg)
    record("WebSocket connect & welcome event", welcome_data.get("type") == "CONNECTED")

    # Send heartbeat ping
    websocket.send_text("ping")
    pong_msg = websocket.receive_text()
    pong_data = json.loads(pong_msg)
    record("WebSocket ping-pong heartbeat", pong_data.get("type") == "PONG")

# Test SSE route registration
sse_route = next((r for r in app.routes if getattr(r, "path", "") == "/events"), None)
record("GET /events (SSE route registered)", sse_route is not None)

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
print("\n========== Test Summary ==========")
passed_count = sum(results)
total_count = len(results)
print(f"  {passed_count}/{total_count} checks passed.")

if passed_count == total_count:
    print(f"  {PASS} ALL TESTS PASSED SUCCESSFULLY!\n")
    sys.exit(0)
else:
    print(f"  {FAIL} {total_count - passed_count} check(s) failed.\n")
    sys.exit(1)
