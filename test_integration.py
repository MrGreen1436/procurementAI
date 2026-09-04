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
        ok = key in resp.json()
    status = PASS if ok else FAIL
    print(f"  [{status}] {name} (HTTP {resp.status_code})")
    if not ok:
        print(f"         Response: {resp.text[:300]}")
    results.append(ok)
    return resp.json() if ok else {}


print("\n========== Procurement Agent Integration Tests ==========\n")

# 1. Health check
print("1. Health check")
r = requests.get(f"{BASE}/health")
check("GET /health", r, key="status")

# 2. Inventory lookup
print("\n2. Inventory")
r = requests.get(f"{BASE}/inventory/SKU-001")
check("GET /inventory/SKU-001", r)
r = requests.get(f"{BASE}/inventory/INVALID-SKU")
check("GET /inventory/INVALID-SKU → 404", r, expected_status=404)

# 3. Forecast
print("\n3. Forecast")
r = requests.get(f"{BASE}/forecast/SKU-001?horizon_days=14")
check("GET /forecast/SKU-001", r)

# 4. Suppliers
print("\n4. Suppliers")
r = requests.get(f"{BASE}/suppliers/SKU-001")
check("GET /suppliers/SKU-001", r)
r = requests.get(f"{BASE}/suppliers/performance/SUP-01")
check("GET /suppliers/performance/SUP-01", r)

# 5. Risk alerts
print("\n5. Risk Alerts")
r = requests.get(f"{BASE}/risk/alerts")
check("GET /risk/alerts", r)

# 6. Agent run
print("\n6. Agent Run")
r = requests.post(f"{BASE}/agent/run", json={"dry_run": False}, timeout=120)
data = check("POST /agent/run", r, key="created_pos")
pos = data.get("created_pos", [])
print(f"         Mode: {data.get('mode', 'unknown')} | POs created: {len(pos)}")
for po in pos:
    print(f"           → {po['po_id']} | {po['status']} | ${po['total_cost']:.2f} | by={po.get('generated_by','?')}")

# 7. List POs
print("\n7. List POs")
r = requests.get(f"{BASE}/agent/pos")
check("GET /agent/pos", r)
all_pos = r.json()

# 8. Approve / Reject a PO
print("\n8. Approve & Reject")
if all_pos:
    first_po_id = all_pos[0]["po_id"]
    r = requests.post(f"{BASE}/agent/approve/{first_po_id}")
    check(f"POST /agent/approve/{first_po_id}", r)
    if len(all_pos) > 1:
        second_po_id = all_pos[1]["po_id"]
        r = requests.post(f"{BASE}/agent/reject/{second_po_id}")
        check(f"POST /agent/reject/{second_po_id}", r)
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
    print(f"         Answer: {data['answer'][:200]}")
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
    print(f"         Summary: {data.get('summary', '')[:120]}")

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
