"""
services/enriched_engine.py
───────────────────────────────────────────────────────────────────────────────
All 5 Tier-1 features wired to the REAL columns in
retail_store_inventory_enriched.csv.

Column names used exactly as they appear in the CSV:
  Store ID, Product ID, Category, Inventory Level, Units Sold, Units Ordered,
  Demand Forecast, Price, Competitor Pricing, Discount, supplier_id,
  supplier_name, supplier_phone, lead_time_days, reorder_level,
  hours_since_update, mismatch_count, last_known_price, is_anomaly,
  anomaly_reason, Date

Feature map
-----------
  Feature 1 — Emergency Decision Engine   : make_procurement_decision()
  Feature 2 — Supplier Trust Score        : update_supplier_trust_scores()
  Feature 3 — Inventory Confidence Score  : compute_inventory_confidence()
  Feature 4 — Predictive Depletion Alert  : check_depletion()
  Feature 5 — Idempotent Recalibration    : apply_feedback_safely()
"""

from __future__ import annotations

import os
import io
import logging
from typing import Callable, Optional

import pandas as pd

logger = logging.getLogger("enriched_engine")

# ---------------------------------------------------------------------------
# Dataset loader
# ---------------------------------------------------------------------------
_ENRICHED_CSV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "retail_store_inventory_enriched.csv",
)

_df_cache: Optional[pd.DataFrame] = None


def _load_enriched(csv_path: str = _ENRICHED_CSV) -> pd.DataFrame:
    """
    Load (and cache) the enriched dataset.
    Parses Date column and sorts chronologically.
    """
    global _df_cache
    if _df_cache is not None:
        return _df_cache

    if not os.path.exists(csv_path):
        raise FileNotFoundError(
            f"Enriched dataset not found at {csv_path}. "
            "Copy retail_store_inventory_enriched.csv to the project root."
        )

    logger.info("Loading enriched dataset from %s ...", csv_path)
    with open(csv_path, "r", encoding="utf-8") as fh:
        raw = fh.read()

    df = pd.read_csv(io.StringIO(raw))
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").reset_index(drop=True)

    # Ensure boolean dtype for is_anomaly (CSV may store True/False as strings)
    if "is_anomaly" in df.columns:
        df["is_anomaly"] = df["is_anomaly"].astype(bool)

    _df_cache = df
    logger.info(
        "Enriched dataset loaded: %d rows | %d stores | %d products | %d suppliers",
        len(df),
        df["Store ID"].nunique(),
        df["Product ID"].nunique(),
        df["supplier_id"].nunique(),
    )
    return df


def reload_enriched(csv_path: str = _ENRICHED_CSV) -> pd.DataFrame:
    """Force a cache-busting reload (e.g., after a new CSV is uploaded)."""
    global _df_cache
    _df_cache = None
    return _load_enriched(csv_path)


# ===========================================================================
# FEATURE 3 -- Inventory Confidence Scoring
# (defined before Feature 1 because Feature 1 calls it)
# ===========================================================================

def compute_inventory_confidence(row: dict) -> dict:
    """
    Score 0-100 expressing how much we trust the inventory record for a
    specific Product ID x Store ID combination.

    Uses REAL columns:
      hours_since_update  -- data staleness (float, hours)
      Inventory Level     -- current stock quantity
      reorder_level       -- low-stock threshold derived per-product
      mismatch_count      -- count of past physical-vs-system discrepancies

    Component weights
    -----------------
    verification_score (max 30): penalises stale data
      < 24h  => +30
      < 72h  => +20
      < 168h => +10
      >= 168h => max(-20, -(hours_past_week / 24))  (decays into negatives)

    stock_score (max 20): ratio of current stock to reorder threshold
      ratio > 1.5 => +20 (comfortable buffer)
      ratio > 0.5 => +10 (marginal)
      ratio <= 0.5 => +0 (dangerously low)

    mismatch_score (max 20): physical-vs-system count accuracy
      0 mismatches => +20
      1 mismatch   => +10
      2+ mismatches => -10

    Returns
    -------
    {"confidence_score": int}
    """
    hours_old = float(row["hours_since_update"])

    if hours_old < 24:
        verification_score = 30
    elif hours_old < 72:
        verification_score = 20
    elif hours_old < 168:
        verification_score = 10
    else:
        verification_score = max(-20, -int((hours_old - 168) / 24))

    stock_ratio = float(row["Inventory Level"]) / max(float(row["reorder_level"]), 1)
    stock_score = 20 if stock_ratio > 1.5 else (10 if stock_ratio > 0.5 else 0)

    mc = int(row["mismatch_count"])
    mismatch_score = 20 if mc == 0 else (10 if mc == 1 else -10)

    confidence = max(0, min(100, verification_score + stock_score + mismatch_score))
    logger.debug(
        "[F3] %s@%s => ver=%d stock=%d mismatch=%d => confidence=%d",
        row.get("Product ID"), row.get("Store ID"),
        verification_score, stock_score, mismatch_score, confidence,
    )
    return {"confidence_score": confidence}


# ===========================================================================
# FEATURE 1 -- Emergency Decision Engine
# ===========================================================================

def make_procurement_decision(
    confidence_score: float,
    retrieval_minutes: int,
    in_stock: bool,
) -> dict:
    """
    Three-way gate: use existing inter-store stock, flag for manual review,
    or proceed with external supplier procurement.

    Parameters
    ----------
    confidence_score   : 0-100, from compute_inventory_confidence() (Feature 3)
    retrieval_minutes  : Estimated inter-store transfer time.
                         Derived as: lead_time_days x 1440 x 0.10
                         Assumption: inter-store transfer is ~10% of a fresh
                         supplier order lead time (same SKU is closer, no
                         customs/shipment booking delay).
    in_stock           : True if ANY other Store ID has Inventory Level >
                         that store's own reorder_level for the same Product ID.

    Returns
    -------
    {"decision": str, "severity": str}
    """
    if in_stock and confidence_score >= 70 and retrieval_minutes <= 30:
        return {"decision": "Use Internal Stock", "severity": "safe"}
    elif in_stock and (confidence_score >= 40 or retrieval_minutes > 30):
        return {"decision": "Verify Manually First", "severity": "caution"}
    else:
        return {"decision": "Proceed with Procurement", "severity": "critical"}


def evaluate_decision_for_row(row: dict) -> dict:
    """
    Full Feature 1+3 pipeline for a single enriched-dataset row.

    Checks ALL other stores for surplus of the same Product ID, computes
    retrieval_minutes using the lead_time_days proxy, scores confidence
    via Feature 3, then calls make_procurement_decision.

    Returns
    -------
    {
      "confidence_score": int,
      "in_stock_at_other_store": bool,
      "surplus_store_id": str | None,
      "retrieval_minutes": int,
      "decision": str,
      "severity": str,
    }
    """
    df = _load_enriched()
    product_id = row["Product ID"]
    store_id   = row["Store ID"]

    # Check other stores for surplus (Inventory Level > their own reorder_level)
    other_stores = df[
        (df["Product ID"] == product_id) &
        (df["Store ID"] != store_id)
    ]

    # Use the most-recent snapshot per store
    latest_per_store = (
        other_stores.sort_values("Date")
        .groupby("Store ID")
        .last()
        .reset_index()
    )

    surplus_rows = latest_per_store[
        latest_per_store["Inventory Level"] > latest_per_store["reorder_level"]
    ]

    in_stock = not surplus_rows.empty
    surplus_store = str(surplus_rows.iloc[0]["Store ID"]) if in_stock else None

    # retrieval_minutes proxy:
    # lead_time_days x 1440 min/day x 0.10
    # (inter-store transfer assumed 10% of supplier lead time)
    lead_days = float(row["lead_time_days"])
    retrieval_minutes = int(lead_days * 1440 * 0.10)

    # Feature 3 -- confidence score
    confidence_result = compute_inventory_confidence(row)
    confidence_score  = confidence_result["confidence_score"]

    # Feature 1 -- decision
    decision_result = make_procurement_decision(
        confidence_score=confidence_score,
        retrieval_minutes=retrieval_minutes,
        in_stock=in_stock,
    )

    return {
        "confidence_score":        confidence_score,
        "in_stock_at_other_store": in_stock,
        "surplus_store_id":        surplus_store,
        "retrieval_minutes":       retrieval_minutes,
        "decision":                decision_result["decision"],
        "severity":                decision_result["severity"],
    }


# ===========================================================================
# FEATURE 2 -- Supplier Trust Score (Decay / Recovery)
# ===========================================================================

# Module-level mutable trust score registry.
# Keys are supplier_id strings ("SUP-001" ... "SUP-010").
# Start all at 80 as specified.
SUPPLIER_TRUST_SCORES: dict[str, float] = {}


def _init_trust_scores(csv_path: str = _ENRICHED_CSV) -> dict[str, float]:
    """
    Initialise trust scores at 80 for all supplier_ids found in the dataset.
    Idempotent -- safe to call multiple times.
    """
    df = _load_enriched(csv_path)
    for sup_id in df["supplier_id"].unique():
        if sup_id not in SUPPLIER_TRUST_SCORES:
            SUPPLIER_TRUST_SCORES[sup_id] = 80.0
    logger.info("[F2] Trust scores initialised for %d suppliers.", len(SUPPLIER_TRUST_SCORES))
    return SUPPLIER_TRUST_SCORES


def update_supplier_trust_scores(
    suppliers: dict[str, float],
    flagged_orders_by_supplier: dict[str, int],
) -> dict[str, float]:
    """
    Decay trust for suppliers with anomalous orders; recover trust for clean ones.

    Parameters
    ----------
    suppliers                  : supplier_id -> current trust_score (0-100)
    flagged_orders_by_supplier : supplier_id -> count of is_anomaly==True rows
                                 for that supplier in the evaluation window

    Rules
    -----
    flagged > 0 => penalty = min(flagged_count x 5, 30)
                   new_score = max(0, score - penalty x 0.1)
    flagged = 0 => new_score = min(100, score + 0.5)  (slow recovery)

    Returns the mutated suppliers dict.
    """
    for supplier_id, trust_score in suppliers.items():
        flagged_count = flagged_orders_by_supplier.get(supplier_id, 0)
        if flagged_count > 0:
            penalty = min(flagged_count * 5, 30)
            suppliers[supplier_id] = max(0.0, trust_score - penalty * 0.1)
        else:
            suppliers[supplier_id] = min(100.0, trust_score + 0.5)

    logger.debug("[F2] Trust scores updated.")
    return suppliers


def compute_flagged_orders(
    df: pd.DataFrame,
    window_start: Optional[pd.Timestamp] = None,
    window_end: Optional[pd.Timestamp] = None,
) -> dict[str, int]:
    """
    Count is_anomaly==True rows per supplier_id within an optional date window.
    """
    subset = df.copy()
    if window_start is not None:
        subset = subset[subset["Date"] >= window_start]
    if window_end is not None:
        subset = subset[subset["Date"] <= window_end]

    anomaly_counts = (
        subset[subset["is_anomaly"] == True]
        .groupby("supplier_id")
        .size()
        .to_dict()
    )
    all_suppliers = df["supplier_id"].unique()
    return {sup: anomaly_counts.get(sup, 0) for sup in all_suppliers}


def run_daily_trust_update(
    simulation_date: Optional[pd.Timestamp] = None,
    window_days: int = 1,
) -> dict[str, float]:
    """
    Simulate a one-day trust update pass for replay/demo purposes.
    Defaults to the last date in the dataset.
    """
    global SUPPLIER_TRUST_SCORES
    df = _load_enriched()

    if not SUPPLIER_TRUST_SCORES:
        _init_trust_scores()

    if simulation_date is None:
        simulation_date = df["Date"].max()

    window_start = simulation_date - pd.Timedelta(days=window_days - 1)
    flagged = compute_flagged_orders(df, window_start=window_start, window_end=simulation_date)
    update_supplier_trust_scores(SUPPLIER_TRUST_SCORES, flagged)

    logger.info(
        "[F2] Daily trust update for %s: anomalies=%s",
        simulation_date.date(),
        {k: v for k, v in flagged.items() if v > 0},
    )
    return dict(SUPPLIER_TRUST_SCORES)


def run_full_chronological_trust_simulation() -> list[dict]:
    """
    Replay the entire enriched dataset day-by-day to show meaningful trust
    movement -- required for a compelling demo (a single call barely moves scores).

    Returns list of {"date": str, "trust_scores": dict} snapshots, one per day.
    """
    global SUPPLIER_TRUST_SCORES
    df = _load_enriched()

    # Reset scores to 80 for clean simulation
    SUPPLIER_TRUST_SCORES = {sup: 80.0 for sup in df["supplier_id"].unique()}
    snapshots = []

    for sim_date, day_df in df.groupby(df["Date"].dt.date):
        flagged = compute_flagged_orders(day_df)
        update_supplier_trust_scores(SUPPLIER_TRUST_SCORES, flagged)
        snapshots.append({
            "date":         str(sim_date),
            "trust_scores": dict(SUPPLIER_TRUST_SCORES),
        })

    logger.info("[F2] Full simulation complete -- %d days replayed.", len(snapshots))
    return snapshots


# ===========================================================================
# FEATURE 4 -- Predictive Depletion Alerts
# ===========================================================================

def check_depletion(
    current_inventory: int,
    avg_daily_units_sold: float,
    reorder_level: int,
) -> dict:
    """
    Raise an alert when current stock is projected to run out within 14 days.

    Parameters
    ----------
    current_inventory    : Inventory Level for this Product x Store today.
    avg_daily_units_sold : Average of Units Sold over the trailing 30 days.
    reorder_level        : The reorder threshold for this Product x Store.

    Returns
    -------
    {"alert": False}
    or
    {"alert": True, "days_left": float, "suggested_order_qty": int}
    """
    if avg_daily_units_sold <= 0:
        return {"alert": False}

    days_left = current_inventory / avg_daily_units_sold

    if days_left < 14:
        return {
            "alert":               True,
            "days_left":           round(days_left, 1),
            "suggested_order_qty": max(1, int(avg_daily_units_sold * 30)),
        }
    return {"alert": False}


def compute_depletion_alerts(
    csv_path: str = _ENRICHED_CSV,
    trailing_days: int = 30,
) -> list[dict]:
    """
    Run check_depletion for every Product x Store combination.

    Uses trailing `trailing_days` days of Units Sold to calculate avg daily
    demand, and the most-recent Inventory Level as current stock.

    Returns list of alert dicts (only where alert=True), sorted by days_left
    ascending (most urgent first).
    """
    df = _load_enriched(csv_path)
    cutoff = df["Date"].max() - pd.Timedelta(days=trailing_days)

    # Latest snapshot per Product x Store
    latest = (
        df.sort_values("Date")
        .groupby(["Store ID", "Product ID"])
        .last()
        .reset_index()
    )

    # Average Units Sold over trailing window
    trailing = df[df["Date"] >= cutoff]
    avg_sold = (
        trailing.groupby(["Store ID", "Product ID"])["Units Sold"]
        .mean()
        .reset_index()
        .rename(columns={"Units Sold": "avg_daily_units_sold"})
    )

    merged = latest.merge(avg_sold, on=["Store ID", "Product ID"], how="left")
    merged["avg_daily_units_sold"] = merged["avg_daily_units_sold"].fillna(0)

    alerts = []
    for _, row in merged.iterrows():
        result = check_depletion(
            current_inventory    = int(row["Inventory Level"]),
            avg_daily_units_sold = float(row["avg_daily_units_sold"]),
            reorder_level        = int(row["reorder_level"]),
        )
        if result.get("alert"):
            alerts.append({
                "store_id":             row["Store ID"],
                "product_id":           row["Product ID"],
                "category":             row["Category"],
                "supplier_id":          row["supplier_id"],
                "supplier_name":        row["supplier_name"],
                "supplier_phone":       row["supplier_phone"],
                "inventory_level":      int(row["Inventory Level"]),
                "reorder_level":        int(row["reorder_level"]),
                "avg_daily_units_sold": round(float(row["avg_daily_units_sold"]), 2),
                "days_left":            result["days_left"],
                "suggested_order_qty":  result["suggested_order_qty"],
            })

    alerts.sort(key=lambda a: a["days_left"])
    logger.info("[F4] Depletion alerts: %d Product x Store pairs at risk.", len(alerts))
    return alerts


# ===========================================================================
# FEATURE 5 -- Idempotent Recalibration Guard
# ===========================================================================

def apply_feedback_safely(record: dict, apply_function: Callable[[dict], None]) -> dict:
    """
    Route any human approval/rejection through this guard for exactly-once
    application of the feedback effect.

    Parameters
    ----------
    record          : Mutable dict with a "feedback_applied" key
                      (defaults to False via .get()).
    apply_function  : Callable that receives `record` and applies the mutation.

    Returns
    -------
    {"status": "applied"}
    or
    {"status": "skipped", "reason": "already applied"}
    """
    if record.get("feedback_applied"):
        return {"status": "skipped", "reason": "already applied"}

    # State mutation FIRST, flag SECOND (crash-safe ordering).
    apply_function(record)
    record["feedback_applied"] = True
    return {"status": "applied"}


# ===========================================================================
# Anomaly record store (in-memory, for Feature 5 demo)
# Keys: "<Store ID>-<Product ID>-<Date>" strings.
# ===========================================================================
ANOMALY_RECORDS: dict[str, dict] = {}


def load_anomaly_records(csv_path: str = _ENRICHED_CSV) -> dict[str, dict]:
    """
    Populate ANOMALY_RECORDS from the enriched dataset's is_anomaly==True rows.
    Each record gets feedback_applied=False on first load.
    """
    global ANOMALY_RECORDS
    df = _load_enriched(csv_path)
    anomalies = df[df["is_anomaly"] == True].copy()

    for _, row in anomalies.iterrows():
        key = f"{row['Store ID']}-{row['Product ID']}-{row['Date'].date()}"
        if key not in ANOMALY_RECORDS:
            ANOMALY_RECORDS[key] = {
                "store_id":         row["Store ID"],
                "product_id":       row["Product ID"],
                "date":             str(row["Date"].date()),
                "supplier_id":      row["supplier_id"],
                "anomaly_reason":   str(row.get("anomaly_reason", "")),
                "inventory_level":  int(row["Inventory Level"]),
                "units_sold":       int(row["Units Sold"]),
                "feedback_applied": False,
            }

    logger.info("[F5] Loaded %d anomaly records.", len(ANOMALY_RECORDS))
    return ANOMALY_RECORDS


# ===========================================================================
# Startup initialisation
# ===========================================================================

def initialise_enriched_engine(csv_path: str = _ENRICHED_CSV) -> None:
    """
    Bootstrap all stateful Feature 2 + Feature 5 structures.
    Call once at FastAPI startup (or when a new CSV is uploaded).
    """
    try:
        _load_enriched(csv_path)
        _init_trust_scores(csv_path)
        load_anomaly_records(csv_path)
        logger.info("[EnrichedEngine] All features initialised successfully.")
    except FileNotFoundError as e:
        logger.warning("[EnrichedEngine] Could not initialise: %s", e)


# ===========================================================================
# FEATURE 6 -- Predictive Site Risk Scoring (per supplier_id)
# ===========================================================================
#
# "Site" in this codebase maps to supplier_id — anomalies (price deviations,
# excess orders) are supplier-sourced events, and supplier_id is the entity
# that already powers Feature 2 trust scores.  Grouping here by supplier_id
# makes the risk score a natural complement to the trust score.
#
# Three signals combined into one 0-1 score:
#   anomaly_rate   (weight 0.6) — fraction of rows flagged is_anomaly==True
#   weekend_rate   (weight 0.2) — fraction placed on Sat/Sun (day-of-week 5/6)
#   amount_factor  (weight 0.2) — avg(Price × Units Ordered) / AMOUNT_CEILING
#
# Amount ceiling calibration:
#   Actual data: mean order amount ≈ 6 071, 95th pct ≈ 14 629, max ≈ 19 978.
#   Reference code used 50 000 — that would compress every supplier to ≈0.12,
#   making the factor meaningless.  We use 15 000 (≈ 95th pct) so high-value
#   suppliers actually register on the scale.
#
# Traffic-light thresholds (configurable at call time):
#   green  : risk_score < 0.30
#   yellow : 0.30 ≤ risk_score < 0.60
#   red    : risk_score ≥ 0.60
#
# Minimum sample guard: suppliers with < 10 rows return risk_score=None.
# ===========================================================================

_AMOUNT_CEILING = 15_000.0   # ≈ 95th percentile of (Price × Units Ordered)
_MIN_ROWS       = 10         # minimum rows before we trust the score


def _traffic_light(score: float) -> str:
    if score < 0.30:
        return "green"
    if score < 0.60:
        return "yellow"
    return "red"


def predict_supplier_risk(rows_for_supplier: pd.DataFrame) -> dict:
    """
    Compute the Predictive Site Risk Score for a single supplier's rows.

    Parameters
    ----------
    rows_for_supplier : Subset of the enriched DataFrame for one supplier_id.
                        Must include: is_anomaly (bool), Date (datetime),
                        Price (float), Units Ordered (float/int).

    Returns
    -------
    {
        "risk_score":   float (0-1, rounded to 3 dp) or None,
        "label":        "green" | "yellow" | "red" | "insufficient_data",
        "anomaly_rate": float,
        "weekend_rate": float,
        "avg_amount":   float,
        "n_rows":       int,
        "note":         str (only present when data insufficient),
    }
    """
    n = len(rows_for_supplier)
    if n < _MIN_ROWS:
        return {
            "risk_score":   None,
            "label":        "insufficient_data",
            "n_rows":       n,
            "note":         f"Need at least {_MIN_ROWS} rows, got {n}",
        }

    # Signal 1 — anomaly rate: is_anomaly is a native bool column
    anomaly_rate = float(rows_for_supplier["is_anomaly"].mean())

    # Signal 2 — weekend rate: derived from Date (dayofweek 5=Sat, 6=Sun)
    weekend_mask = rows_for_supplier["Date"].dt.dayofweek >= 5
    weekend_rate = float(weekend_mask.mean())

    # Signal 3 — order amount factor: Price × Units Ordered, capped at ceiling
    order_amounts = rows_for_supplier["Price"] * rows_for_supplier["Units Ordered"]
    avg_amount    = float(order_amounts.mean())
    amount_factor = min(avg_amount / _AMOUNT_CEILING, 1.0)

    # Weighted composite
    risk_score = (
        anomaly_rate  * 0.6
        + weekend_rate  * 0.2
        + amount_factor * 0.2
    )

    return {
        "risk_score":   round(risk_score, 3),
        "label":        _traffic_light(risk_score),
        "anomaly_rate": round(anomaly_rate, 4),
        "weekend_rate": round(weekend_rate, 4),
        "avg_amount":   round(avg_amount, 2),
        "n_rows":       n,
    }


def compute_all_supplier_risks(
    csv_path: str = _ENRICHED_CSV,
    trailing_days: Optional[int] = None,
    green_threshold:  float = 0.30,
    yellow_threshold: float = 0.60,
) -> list[dict]:
    """
    Run predict_supplier_risk for every supplier_id in the enriched dataset.

    Parameters
    ----------
    csv_path        : Path to enriched CSV (uses cache if already loaded).
    trailing_days   : If set, only use the most recent N days of data.
                      If None, uses all history.
    green_threshold : Upper bound for green label (default 0.30).
    yellow_threshold: Upper bound for yellow label (default 0.60).

    Returns
    -------
    List of dicts sorted by risk_score descending (highest risk first).
    Each dict includes supplier_id, supplier_name (if available), and all
    fields from predict_supplier_risk().
    """
    df = _load_enriched(csv_path)

    if trailing_days is not None:
        cutoff = df["Date"].max() - pd.Timedelta(days=trailing_days)
        df = df[df["Date"] >= cutoff].copy()

    # Lookup supplier_name per supplier_id (from any row)
    name_lookup: dict[str, str] = (
        df.groupby("supplier_id")["supplier_name"]
        .first()
        .to_dict()
    )

    results = []
    for supplier_id, group in df.groupby("supplier_id"):
        score_dict = predict_supplier_risk(group)

        # Override thresholds if caller customised them
        if score_dict["risk_score"] is not None:
            s = score_dict["risk_score"]
            if s < green_threshold:
                score_dict["label"] = "green"
            elif s < yellow_threshold:
                score_dict["label"] = "yellow"
            else:
                score_dict["label"] = "red"

        results.append({
            "supplier_id":   supplier_id,
            "supplier_name": name_lookup.get(supplier_id, ""),
            **score_dict,
        })

    # Sort: None scores last, then descending by risk_score
    results.sort(
        key=lambda r: (r["risk_score"] is None, -(r["risk_score"] or 0))
    )

    logger.info(
        "[F6] Supplier risk scores computed for %d suppliers "
        "(trailing_days=%s).",
        len(results),
        trailing_days,
    )
    return results

