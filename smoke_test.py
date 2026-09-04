import requests, json
BASE = "http://localhost:8000"

# Health
r = requests.get(f"{BASE}/health")
print("Health:", r.status_code, r.json())

# Risk alerts
r = requests.get(f"{BASE}/risk/alerts")
alerts = r.json()
print("Risk alerts:", len(alerts), "total")
if alerts:
    print("  First:", alerts[0]["alert_id"])

# Agent run (fallback mode since no API key)
r = requests.post(f"{BASE}/agent/run", json={"dry_run": False}, timeout=30)
d = r.json()
pos = d.get("created_pos", [])
transfers = d.get("transfer_recommendations", [])
print(f"Agent run: mode={d['mode']}, POs={len(pos)}, transfers={len(transfers)}")
for po in pos:
    print(f"  PO: {po['po_id']} | {po['status']} | ${po['total_cost']:.2f} | by={po['generated_by']}")
for t in transfers:
    print(f"  TRANSFER: {t.get('sku_id')} — confidence={t.get('confidence_score')}")

# List all POs
r = requests.get(f"{BASE}/agent/pos")
all_pos = r.json()
print(f"Total POs in store: {len(all_pos)}")

# Approve + idempotency check
if all_pos:
    po_id = all_pos[0]["po_id"]
    r1 = requests.post(f"{BASE}/agent/approve/{po_id}")
    print(f"Approve 1st call: {r1.status_code}")
    r2 = requests.post(f"{BASE}/agent/approve/{po_id}")
    is_skipped = r2.json().get("status") == "skipped"
    print(f"Approve 2nd call (idempotency): {r2.status_code}, skipped={is_skipped}")

# 404 for invalid PO
r = requests.post(f"{BASE}/agent/approve/PO-DOESNOTEXIST")
print(f"Approve invalid PO: {r.status_code} (expect 404)")

print("\nAll smoke tests complete!")
