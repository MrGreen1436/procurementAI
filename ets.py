"""
Baseline forecasting script: ETS (statsmodels) or Prophet.

Runs a UNIVARIATE model per SKU (unlike the global XGBoost model) — this is
the standard, appropriate way to use ETS/Prophet, and it's the "simple
baseline" that XGBoost is meant to be compared against.

Uses the SAME date-based train/test split logic as xgboost_forecast.py, so
the MAE numbers from both scripts are directly comparable for your demo slide.

Usage:
    python baseline_forecast.py --data demand.csv --method ets --out ets_forecasts.csv
    python baseline_forecast.py --data demand.csv --method prophet --out prophet_forecasts.csv

Note: --method prophet requires `pip install prophet` (heavier install,
needs a C++ build toolchain on some systems). --method ets only needs
statsmodels, which is lighter and usually already available — good default
if you're short on setup time.
"""

import argparse
import warnings
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error

warnings.filterwarnings("ignore")  # statsmodels/prophet are noisy with convergence warnings

COL_DATE = "date"
COL_SKU = "sku_id"
COL_TARGET = "demand"


def load_data(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df[COL_DATE] = pd.to_datetime(df[COL_DATE])
    df = df.sort_values([COL_SKU, COL_DATE]).reset_index(drop=True)
    return df


def time_based_split(df: pd.DataFrame, test_frac: float = 0.2):
    cutoff = df[COL_DATE].quantile(1 - test_frac)
    train = df[df[COL_DATE] <= cutoff]
    test = df[df[COL_DATE] > cutoff]
    return train, test


def forecast_ets(train_series: pd.Series, n_periods: int) -> np.ndarray:
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    # Weekly seasonality (period=7), additive trend — matches daily retail data
    model = ExponentialSmoothing(
        train_series,
        trend="add",
        seasonal="add",
        seasonal_periods=7,
        initialization_method="estimated",
    ).fit()
    preds = model.forecast(n_periods)
    return np.clip(preds.values, 0, None)


def forecast_prophet(train_df: pd.DataFrame, n_periods: int) -> np.ndarray:
    from prophet import Prophet

    # Prophet requires columns named exactly 'ds' (date) and 'y' (target)
    prophet_df = train_df.rename(columns={COL_DATE: "ds", COL_TARGET: "y"})
    model = Prophet(weekly_seasonality=True, yearly_seasonality=False, daily_seasonality=False)
    model.fit(prophet_df[["ds", "y"]])

    future = model.make_future_dataframe(periods=n_periods)
    forecast = model.predict(future)
    preds = forecast["yhat"].tail(n_periods).values
    return np.clip(preds, 0, None)


def run_per_sku(df: pd.DataFrame, method: str, test_frac: float):
    all_results = []
    for sku_id, sku_df in df.groupby(COL_SKU):
        sku_df = sku_df.sort_values(COL_DATE).reset_index(drop=True)
        train, test = time_based_split(sku_df, test_frac)

        if len(train) < 14 or len(test) == 0:
            print(f"Skipping {sku_id}: not enough history")
            continue

        n_periods = len(test)
        if method == "ets":
            preds = forecast_ets(train.set_index(COL_DATE)[COL_TARGET], n_periods)
        elif method == "prophet":
            preds = forecast_prophet(train[[COL_DATE, COL_TARGET]], n_periods)
        else:
            raise ValueError(f"Unknown method: {method}")

        result = test[[COL_DATE, COL_SKU, COL_TARGET]].copy()
        result["predicted_demand"] = preds
        all_results.append(result)

        mae = mean_absolute_error(test[COL_TARGET], preds)
        print(f"{sku_id}: MAE = {mae:.2f}")

    return pd.concat(all_results, ignore_index=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--method", choices=["ets", "prophet"], default="ets")
    parser.add_argument("--out", default="baseline_forecasts.csv")
    parser.add_argument("--test-frac", type=float, default=0.2)
    args = parser.parse_args()

    df = load_data(args.data)
    results = run_per_sku(df, args.method, args.test_frac)

    overall_mae = mean_absolute_error(results[COL_TARGET], results["predicted_demand"])
    print(f"\nOverall MAE ({args.method}): {overall_mae:.3f}")

    results.to_csv(args.out, index=False)
    print(f"Saved forecasts to {args.out}")


if __name__ == "__main__":
    main()