"""
test_integration.py — End-to-end smoke test for the Procurement Agent API.

Usage:
    1. Start the server:  uvicorn main:app --reload --port 8000
    2. Run this script:   python test_integration.py

Each step prints PASS or FAIL with details.
No pytest required — plain requests calls.
"""

import sys
import json
import requests

BASE = "http://localhost:8000"
PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
results: list[bool] = []


def check(name: str, resp: requests.Response, expected_status: int = 200, key: str = None):
    ok = resp.status_code == expected_status
    if ok and key:
        try:
            ok = key in resp.json()
        except Exception:
            ok = False
    status = PASS if ok else FAIL
    print(f"  [{status}] {name} (HTTP {resp.status_code})")
    if not ok:
        print(f"         Response: {resp.text[:300]}")
    results.append(ok)
    return resp.json() if resp.status_code < 500 else {}


print("\n========== Procurement Agent Integration Tests ==========\n")

# 1. Health check
print("1. Health check")
r = requests.get(f"{BASE}/health")
check("GET /health", r, key="status")

# 2. Inventory lookup
print("\n2. Inventory")
# First, find a real SKU from the inventory store
r_inv_all = requests.get(f"{BASE}/kpis")  # triggers inventory load
r = requests.get(f"{BASE}/inventory/SKU-001")
if r.status_code == 404:
    # SKU-001 not in CSV — try the alerts endpoint to get a real SKU
    r_alerts = requests.get(f"{BASE}/risk/alerts")
    if r_alerts.status_code == 200 and r_alerts.json():
        real_sku = r_alerts.json()[0].get("sku", "SKU-001")
    else:
        real_sku = "SKU-001"
    r = requests.get(f"{BASE}/inventory/{real_sku}")
    check(f"GET /inventory/{real_sku}", r)
else:
    check("GET /inventory/SKU-001", r)
    real_sku = "SKU-001"

r = requests.get(f"{BASE}/inventory/INVALID-SKU-DOESNOTEXIST")
check("GET /inventory/INVALID-SKU → 404", r, expected_status=404)

# 3. Forecast
print("\n3. Forecast")
r = requests.get(f"{BASE}/forecast/{real_sku}?horizon_days=14")
check(f"GET /forecast/{real_sku}", r)

# 4. Suppliers
print("\n4. Suppliers")
r = requests.get(f"{BASE}/suppliers/{real_sku}")
check(f"GET /suppliers/{real_sku}", r)
suppliers_data = r.json() if r.status_code == 200 else []

# Try to get a real supplier ID from the data
real_supplier_id = None
if suppliers_data:
    real_supplier_id = suppliers_data[0].get("supplier_id")

if real_supplier_id:
    r = requests.get(f"{BASE}/suppliers/performance/{real_supplier_id}")
    check(f"GET /suppliers/performance/{real_supplier_id}", r)
else:
    print("  [SKIP] Could not get a real supplier ID to test performance endpoint")

# 5. Risk alerts
print("\n5. Risk Alerts")
r = requests.get(f"{BASE}/risk/alerts")
check("GET /risk/alerts", r)

# 6. Agent run
print("\n6. Agent Run")
r = requests.post(f"{BASE}/agent/run", json={"dry_run": False}, timeout=120)
data = check("POST /agent/run", r, key="created_pos")
pos = data.get("created_pos", [])
transfers = data.get("transfer_recommendations", [])
print(f"         Mode: {data.get('mode', 'unknown')} | POs created: {len(pos)} | Transfers: {len(transfers)}")
for po in pos:
    print(f"           → {po['po_id']} | {po['status']} | ${po['total_cost']:.2f} | by={po.get('generated_by','?')}")
for t in transfers:
    print(f"           → TRANSFER: {t.get('sku_id')} — {t.get('note', '')[:80]}")

# 7. List POs
print("\n7. List POs")
r = requests.get(f"{BASE}/agent/pos")
check("GET /agent/pos", r)
all_pos = r.json() if r.status_code == 200 else []

# 8. Approve / Reject a PO + idempotency check
print("\n8. Approve & Reject (+ idempotency guard)")
if all_pos:
    first_po_id = all_pos[0]["po_id"]
    r = requests.post(f"{BASE}/agent/approve/{first_po_id}")
    check(f"POST /agent/approve/{first_po_id}", r)

    # Task 5: Idempotency — second call should return skipped
    r2 = requests.post(f"{BASE}/agent/approve/{first_po_id}")
    ok_idempotent = r2.status_code == 200 and r2.json().get("status") == "skipped"
    tag = PASS if ok_idempotent else FAIL
    print(f"  [{tag}] Idempotency: second approve → skipped (HTTP {r2.status_code})")
    if not ok_idempotent:
        print(f"         Response: {r2.text[:200]}")
    results.append(ok_idempotent)

    if len(all_pos) > 1:
        second_po_id = all_pos[1]["po_id"]
        r = requests.post(f"{BASE}/agent/reject/{second_po_id}")
        check(f"POST /agent/reject/{second_po_id}", r)

        # Idempotency for reject too
        r3 = requests.post(f"{BASE}/agent/reject/{second_po_id}")
        ok_idempotent2 = r3.status_code == 200 and r3.json().get("status") == "skipped"
        tag2 = PASS if ok_idempotent2 else FAIL
        print(f"  [{tag2}] Idempotency: second reject → skipped (HTTP {r3.status_code})")
        results.append(ok_idempotent2)
else:
    print("  [SKIP] No POs available to approve/reject")

r = requests.post(f"{BASE}/agent/approve/PO-DOESNOTEXIST")
check("POST /agent/approve/INVALID → 404", r, expected_status=404)

# 9. Natural language query
print("\n9. Natural Language Query")
r = requests.post(
    f"{BASE}/query",
    json={"question": "Which SKU is at highest risk of stockout and which supplier should we use?"},
    timeout=60,
)
data = check("POST /query", r, key="answer")
if data:
    print(f"         Answer: {str(data.get('answer',''))[:200]}")
    print(f"         Tools used: {data.get('tools_used', [])}")

# 10. Email parse
print("\n10. Email Parse")
sample_email = (
    "Dear Procurement Team,\n\n"
    "We regret to inform you that due to a logistics disruption, "
    "delivery of SKU-001 (order ref: ORD-9821) from supplier SUP-02 "
    "will be delayed by 7 days. We apologise for the inconvenience.\n\n"
    "Regards,\nBeta Metals Co"
)
r = requests.post(f"{BASE}/email/parse", json={"raw_email_text": sample_email}, timeout=60)
data = check("POST /email/parse", r, key="summary")
if data:
    print(f"         Extracted: supplier={data.get('supplier_id')} | sku={data.get('sku_id')} | delay={data.get('delay_days')}d")
    print(f"         Summary: {str(data.get('summary', ''))[:120]}")

# 11. Decision Engine visibility check
print("\n11. Decision Engine (verify transfer_recommendations field present)")
r = requests.post(f"{BASE}/agent/run", json={"dry_run": True}, timeout=120)
ok_de = r.status_code == 200 and "transfer_recommendations" in r.json()
tag = PASS if ok_de else FAIL
print(f"  [{tag}] POST /agent/run (dry_run=True) has transfer_recommendations field")
results.append(ok_de)

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
print("\n========== Results ==========")
passed = sum(results)
total = len(results)
print(f"  {passed}/{total} checks passed")
if passed == total:
    print(f"  {PASS} All tests passed!\n")
    sys.exit(0)
else:
    print(f"  {FAIL} {total - passed} test(s) failed — see above for details.\n")
    sys.exit(1)
