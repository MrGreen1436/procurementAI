"""
tier1_test.py
───────────────────────────────────────────────────────────────────────────────
Sanity-check all 5 Tier-1 features using 3 real rows from the enriched dataset:

  Row A — clearly LOW-STOCK  : P0003 @ S001, Inventory=102 < reorder_level=202
  Row B — clearly WELL-STOCKED: P0004 @ S001, Inventory=469 >> reorder_level=203
  Row C — is_anomaly=True    : P0005 @ S001, anomaly_reason="Order quantity far exceeds demand forecast"

Run with:
    python tier1_test.py
from the procurementAI project root (needs retail_store_inventory_enriched.csv there).
"""
import sys
import os

# Make sure project root is on the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd

from services.enriched_engine import (
    compute_inventory_confidence,   # Feature 3
    make_procurement_decision,      # Feature 1
    evaluate_decision_for_row,      # Feature 1+3 combined
    update_supplier_trust_scores,   # Feature 2
    compute_flagged_orders,         # Feature 2 helper
    check_depletion,                # Feature 4
    apply_feedback_safely,          # Feature 5
    _load_enriched,
    _init_trust_scores,
    SUPPLIER_TRUST_SCORES,
)

# ─── Colour helpers ───────────────────────────────────────────────────────────
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

SEV_COLOR = {"safe": GREEN, "caution": YELLOW, "critical": RED}

def banner(title: str):
    print(f"\n{BOLD}{CYAN}{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}{RESET}")

def row_summary(label: str, row: dict):
    print(f"\n{BOLD}{label}{RESET}")
    print(f"  Product ID      : {row['Product ID']}")
    print(f"  Store ID        : {row['Store ID']}")
    print(f"  Inventory Level : {row['Inventory Level']}")
    print(f"  reorder_level   : {row['reorder_level']}")
    print(f"  Units Sold      : {row['Units Sold']}")
    print(f"  hours_since_upd : {row['hours_since_update']}")
    print(f"  mismatch_count  : {row['mismatch_count']}")
    print(f"  supplier_id     : {row['supplier_id']}")
    print(f"  lead_time_days  : {row['lead_time_days']}")
    print(f"  is_anomaly      : {row['is_anomaly']}")
    if row.get('anomaly_reason') and str(row['anomaly_reason']) != 'nan':
        print(f"  anomaly_reason  : {row['anomaly_reason']}")


# ─── Load dataset + pick 3 representative rows ───────────────────────────────
print(f"\n{BOLD}Loading enriched dataset...{RESET}")
df = _load_enriched()
print(f"  Loaded {len(df):,} rows | {df['Store ID'].nunique()} stores | {df['Product ID'].nunique()} products")

# Row A: clearly low stock (Inventory Level < reorder_level)
row_a_df = df[
    (df["Store ID"] == "S001") &
    (df["Product ID"] == "P0003") &
    (df["Date"] == df[(df["Store ID"]=="S001") & (df["Product ID"]=="P0003")]["Date"].min())
]
row_a = row_a_df.iloc[0].to_dict()

# Row B: clearly well-stocked (Inventory Level >> reorder_level)
row_b_df = df[
    (df["Store ID"] == "S001") &
    (df["Product ID"] == "P0004") &
    (df["Date"] == df[(df["Store ID"]=="S001") & (df["Product ID"]=="P0004")]["Date"].min())
]
row_b = row_b_df.iloc[0].to_dict()

# Row C: is_anomaly == True
row_c_df = df[
    (df["is_anomaly"] == True) &
    (df["Store ID"] == "S001") &
    (df["Product ID"] == "P0005")
]
if row_c_df.empty:
    row_c_df = df[df["is_anomaly"] == True].head(1)
row_c = row_c_df.iloc[0].to_dict()

row_summary("ROW A — Low-Stock", row_a)
row_summary("ROW B — Well-Stocked", row_b)
row_summary("ROW C — Anomaly", row_c)


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 3 — Inventory Confidence Scoring
# ─────────────────────────────────────────────────────────────────────────────
banner("FEATURE 3 — Inventory Confidence Scoring")

for label, row in [("Row A (low stock)", row_a), ("Row B (well stocked)", row_b), ("Row C (anomaly)", row_c)]:
    result = compute_inventory_confidence(row)
    score  = result["confidence_score"]
    color  = GREEN if score >= 60 else (YELLOW if score >= 30 else RED)
    print(f"\n  [{label}]")
    print(f"    hours_since_update={row['hours_since_update']} | "
          f"Inventory={row['Inventory Level']} / reorder={row['reorder_level']} | "
          f"mismatches={row['mismatch_count']}")
    print(f"    {color}confidence_score = {score}/100{RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 1 — Emergency Decision Engine (full evaluate_decision_for_row)
# ─────────────────────────────────────────────────────────────────────────────
banner("FEATURE 1 — Emergency Decision Engine (wired through enriched dataset)")

for label, row in [("Row A (low stock)", row_a), ("Row B (well stocked)", row_b), ("Row C (anomaly)", row_c)]:
    result = evaluate_decision_for_row(row)
    sev_c  = SEV_COLOR.get(result["severity"], "")
    print(f"\n  [{label}]")
    print(f"    confidence_score      = {result['confidence_score']}")
    print(f"    in_stock_at_other_store = {result['in_stock_at_other_store']}  (surplus_store={result['surplus_store_id']})")
    print(f"    retrieval_minutes     = {result['retrieval_minutes']}")
    print(f"    {sev_c}Decision: {result['decision']}  [{result['severity'].upper()}]{RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 2 — Supplier Trust Score (Decay / Recovery)
# ─────────────────────────────────────────────────────────────────────────────
banner("FEATURE 2 — Supplier Trust Score (one evaluation window)")

_init_trust_scores()
initial_scores = dict(SUPPLIER_TRUST_SCORES)

flagged = compute_flagged_orders(df)  # all-time anomaly counts per supplier
print("\n  Anomaly counts per supplier (all-time):")
for sup, cnt in sorted(flagged.items()):
    print(f"    {sup} : {cnt} flagged orders")

# Show scores before
print(f"\n  Trust scores BEFORE update (all start at 80.0):")
for sup in sorted(initial_scores.keys()):
    print(f"    {sup} = {initial_scores[sup]:.1f}")

# Run one update
SUPPLIER_TRUST_SCORES_COPY = dict(SUPPLIER_TRUST_SCORES)  # operate on copy for display
update_supplier_trust_scores(SUPPLIER_TRUST_SCORES_COPY, flagged)

print(f"\n  Trust scores AFTER one update (decay for flagged, +0.5 for clean):")
for sup in sorted(SUPPLIER_TRUST_SCORES_COPY.keys()):
    before = initial_scores[sup]
    after  = SUPPLIER_TRUST_SCORES_COPY[sup]
    delta  = after - before
    color  = RED if delta < 0 else (GREEN if delta > 0 else "")
    print(f"    {sup} : {before:.1f} -> {color}{after:.2f} ({delta:+.2f}){RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 4 — Predictive Depletion Alerts
# ─────────────────────────────────────────────────────────────────────────────
banner("FEATURE 4 — Predictive Depletion Alerts (check_depletion)")

# Compute avg Units Sold over last 30 days for our 3 rows
cutoff = df["Date"].max() - pd.Timedelta(days=30)
trailing = df[df["Date"] >= cutoff]

for label, row in [("Row A (low stock)", row_a), ("Row B (well stocked)", row_b), ("Row C (anomaly)", row_c)]:
    mask = (trailing["Product ID"] == row["Product ID"]) & (trailing["Store ID"] == row["Store ID"])
    avg_sold = trailing[mask]["Units Sold"].mean()
    result = check_depletion(
        current_inventory    = int(row["Inventory Level"]),
        avg_daily_units_sold = float(avg_sold) if not pd.isna(avg_sold) else 0.0,
        reorder_level        = int(row["reorder_level"]),
    )
    print(f"\n  [{label}]")
    print(f"    Inventory={row['Inventory Level']} | avg_daily_sold={avg_sold:.1f} | reorder_level={row['reorder_level']}")
    if result["alert"]:
        print(f"    {RED}ALERT! days_left={result['days_left']} | suggested_order_qty={result['suggested_order_qty']}{RESET}")
    else:
        print(f"    {GREEN}No alert — stock sufficient for >= 14 days{RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 5 — Idempotent Recalibration Guard
# ─────────────────────────────────────────────────────────────────────────────
banner("FEATURE 5 — Idempotent Recalibration Guard (apply_feedback_safely)")

# Simulate an anomaly record
test_record = {
    "store_id":         row_c["Store ID"],
    "product_id":       row_c["Product ID"],
    "supplier_id":      row_c["supplier_id"],
    "anomaly_reason":   str(row_c.get("anomaly_reason", "")),
    "feedback_applied": False,
    "human_decision":   None,
}

applied_count = [0]

def _mock_apply(rec: dict):
    rec["human_decision"] = "approved"
    applied_count[0] += 1

print(f"\n  Initial record: feedback_applied={test_record['feedback_applied']}")

result1 = apply_feedback_safely(test_record, _mock_apply)
print(f"  1st call: {GREEN}{result1}{RESET}  | feedback_applied={test_record['feedback_applied']} | human_decision={test_record['human_decision']}")

result2 = apply_feedback_safely(test_record, _mock_apply)
print(f"  2nd call: {YELLOW}{result2}{RESET}  | apply_function called total={applied_count[0]} times (should be 1)")

assert applied_count[0] == 1, "FAIL: apply_function was called more than once!"
print(f"  {GREEN}PASS: apply_function called exactly once despite 2 calls{RESET}")

# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{BOLD}{GREEN}All 5 Tier-1 feature checks complete.{RESET}\n")
