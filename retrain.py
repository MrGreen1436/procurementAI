"""
retrain.py
──────────────────────────────────────────────────────────────────────────────
Retrains the XGBoost demand-forecasting model on a newly uploaded CSV that
must have the same column schema as retail_store_inventory_enriched.csv:

  Store ID, Product ID, Category, Region, Weather Condition, Seasonality,
  Inventory Level, Units Sold, Units Ordered, Demand Forecast, Price,
  Competitor Pricing, Discount, Holiday/Promotion, supplier_id,
  lead_time_days, reorder_level, hours_since_update, mismatch_count,
  last_known_price, Date

Outputs written to models/:
  xgboost_model.json        — XGBoost booster (native JSON format)
  xgboost_encoders.pkl      — dict of {column: LabelEncoder}
  xgboost_feature_cols.json — ordered list of feature column names
  xgboost_metrics.json      — MAE / RMSE / R² on held-out 20 % split

Legacy output (root):
  model.pkl                 — kept so older code that still imports it does
                              not break; written only if the enriched retrain
                              succeeds.

Called from main.py /upload-dataset endpoint:
    import retrain
    retrain.retrain_model(csv_path, model_path)
"""

import os
import json
import warnings
import logging

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import mean_absolute_error, mean_squared_error
from xgboost import XGBRegressor

warnings.filterwarnings("ignore")

logger = logging.getLogger("retrain")

_BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
_MODELS_DIR = os.path.join(_BASE_DIR, "models")

# Columns that will be label-encoded
_CAT_COLS = [
    "Store ID", "Product ID", "Category", "Region",
    "Weather Condition", "Seasonality", "supplier_id",
]

# Target column
_TARGET = "Units Sold"


def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Build the same 30 features that the new-schema XGBoost was trained on.
    The resulting DataFrame contains only the feature columns (no target).
    """
    df = df.copy()

    # ── Date features ────────────────────────────────────────────────────────
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").reset_index(drop=True)
    df["day_of_week"]  = df["Date"].dt.dayofweek
    df["day_of_month"] = df["Date"].dt.day
    df["month"]        = df["Date"].dt.month
    df["week_of_year"] = df["Date"].dt.isocalendar().week.astype(int)
    df["is_weekend"]   = (df["day_of_week"] >= 5).astype(int)

    # ── Lag / rolling features per (Store ID, Product ID) ───────────────────
    grp = df.groupby(["Store ID", "Product ID"])["Units Sold"]
    df["lag_1"]       = grp.shift(1).fillna(0)
    df["lag_7"]       = grp.shift(7).fillna(0)
    df["lag_14"]      = grp.shift(14).fillna(0)
    df["roll_mean_7"] = grp.transform(lambda s: s.shift(1).rolling(7,  min_periods=1).mean()).fillna(0)
    df["roll_std_7"]  = grp.transform(lambda s: s.shift(1).rolling(7,  min_periods=1).std()).fillna(0)
    df["roll_mean_14"]= grp.transform(lambda s: s.shift(1).rolling(14, min_periods=1).mean()).fillna(0)
    df["roll_std_14"] = grp.transform(lambda s: s.shift(1).rolling(14, min_periods=1).std()).fillna(0)

    return df


def retrain_model(csv_path: str = None) -> bool:
    """
    Reads a raw CSV, performs feature engineering, trains XGBoost, and saves
    all artefacts to models/.

    Parameters
    ----------
    csv_path : Path to the uploaded CSV.  Defaults to uploaded_dataset.csv.

    Returns True on success, False on failure.
    """
    if csv_path is None:
        csv_path = os.path.join(_BASE_DIR, "uploaded_dataset.csv")

    os.makedirs(_MODELS_DIR, exist_ok=True)

    try:
        logger.info("Retraining on %s …", csv_path)
        df = pd.read_csv(csv_path)

        # ── Validate required columns ─────────────────────────────────────
        required = {"Store ID", "Product ID", "Category", "Inventory Level",
                    "Units Sold", "Price", "Date"}
        missing = required - set(df.columns)
        if missing:
            logger.error("Uploaded CSV is missing columns: %s", missing)
            return False

        # Fill optional columns with sensible defaults if absent
        for col, default in [
            ("Units Ordered", 0), ("Demand Forecast", 0),
            ("Competitor Pricing", df.get("Price", pd.Series([50.0])).mean()),
            ("Discount", 0), ("Holiday/Promotion", 0),
            ("lead_time_days", 7), ("reorder_level", 50),
            ("hours_since_update", 24), ("mismatch_count", 0),
            ("last_known_price", None),
            ("Region", "Unknown"), ("Weather Condition", "Sunny"),
            ("Seasonality", "Summer"), ("supplier_id", "SUP001"),
        ]:
            if col not in df.columns:
                df[col] = default if default is not None else df.get("Price", 50.0)

        # ── Label encode categoricals ─────────────────────────────────────
        encoders: dict[str, LabelEncoder] = {}
        for col in _CAT_COLS:
            if col in df.columns:
                le = LabelEncoder()
                df[f"{col}_enc"] = le.fit_transform(df[col].astype(str))
                encoders[col] = le

        # ── Engineer features ─────────────────────────────────────────────
        df = _engineer_features(df)

        # ── Define feature matrix ─────────────────────────────────────────
        numeric_feats = [
            "Inventory Level", "Units Ordered", "Price", "Discount",
            "Holiday/Promotion", "Competitor Pricing", "lead_time_days",
            "reorder_level", "hours_since_update", "mismatch_count",
            "last_known_price",
            "day_of_week", "day_of_month", "month", "week_of_year", "is_weekend",
            "lag_1", "lag_7", "lag_14",
            "roll_mean_7", "roll_std_7", "roll_mean_14", "roll_std_14",
        ]
        enc_feats = [f"{c}_enc" for c in _CAT_COLS if f"{c}_enc" in df.columns]
        feature_cols = numeric_feats + enc_feats

        X = df[feature_cols].fillna(0)
        y = df[_TARGET].fillna(0)

        logger.info("Training on %d rows, %d features …", len(X), len(feature_cols))
        print(f"[retrain] Training on {len(X):,} rows × {len(feature_cols)} features …")

        # ── Train / test split (last 20 % = test) ────────────────────────
        split = int(len(X) * 0.8)
        X_train, X_test = X.iloc[:split], X.iloc[split:]
        y_train, y_test = y.iloc[:split], y.iloc[split:]

        model = XGBRegressor(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            objective="reg:squarederror",
            random_state=42,
        )
        model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

        # ── Evaluate ──────────────────────────────────────────────────────
        preds  = np.clip(model.predict(X_test), 0, None)
        mae    = float(mean_absolute_error(y_test, preds))
        rmse   = float(np.sqrt(mean_squared_error(y_test, preds)))
        ss_res = float(np.sum((y_test.values - preds) ** 2))
        ss_tot = float(np.sum((y_test.values - y_test.mean()) ** 2))
        r2     = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
        logger.info("Retrain metrics — MAE %.2f | RMSE %.2f | R² %.4f", mae, rmse, r2)
        print(f"[retrain] MAE={mae:.2f}  RMSE={rmse:.2f}  R²={r2:.4f}")

        # ── Save artefacts to models/ ─────────────────────────────────────
        xgb_json_path    = os.path.join(_MODELS_DIR, "xgboost_model.json")
        encoders_path    = os.path.join(_MODELS_DIR, "xgboost_encoders.pkl")
        feat_cols_path   = os.path.join(_MODELS_DIR, "xgboost_feature_cols.json")
        metrics_path     = os.path.join(_MODELS_DIR, "xgboost_metrics.json")

        model.save_model(xgb_json_path)
        joblib.dump(encoders, encoders_path)
        with open(feat_cols_path, "w") as fh:
            json.dump(feature_cols, fh, indent=2)
        with open(metrics_path, "w") as fh:
            json.dump({"mae": mae, "rmse": rmse, "r2": r2}, fh, indent=2)

        logger.info("Saved artefacts to %s", _MODELS_DIR)
        print(f"[retrain] Artefacts saved to {_MODELS_DIR}/")

        return True

    except Exception as exc:
        logger.error("Retrain failed: %s", exc, exc_info=True)
        print(f"[retrain] FAILED: {exc}")
        return False


if __name__ == "__main__":
    # Quick smoke-test: retrain on the enriched CSV if present
    default_csv = os.path.join(_BASE_DIR, "retail_store_inventory_enriched.csv")
    if os.path.exists(default_csv):
        retrain_model(csv_path=default_csv)
    else:
        print("[retrain] No CSV found — pass csv_path= to retrain_model().")
