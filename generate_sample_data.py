"""
Generates a synthetic demand dataset for the forecasting demo.
Bakes in real, learnable patterns (weekly seasonality, monthly trend,
promotions, price elasticity) so XGBoost has something genuine to pick up
on -- pure random noise would make the model comparison meaningless.

Usage:
    python generate_sample_data.py --out demand.csv
"""

import argparse
import numpy as np
import pandas as pd

np.random.seed(42)

SKUS = [
    {"sku_id": "SKU_001", "base_demand": 120, "price": 199, "category": "grocery"},
    {"sku_id": "SKU_002", "base_demand": 80,  "price": 349, "category": "electronics"},
    {"sku_id": "SKU_003", "base_demand": 200, "price": 99,  "category": "grocery"},
    {"sku_id": "SKU_004", "base_demand": 45,  "price": 899, "category": "electronics"},
    {"sku_id": "SKU_005", "base_demand": 150, "price": 149, "category": "household"},
    {"sku_id": "SKU_006", "base_demand": 60,  "price": 499, "category": "household"},
]

N_DAYS = 180  # ~6 months of daily history per SKU


def generate_sku_series(sku_id, base_demand, base_price, category, start_date):
    dates = pd.date_range(start=start_date, periods=N_DAYS, freq="D")

    # Slow upward trend over the period
    trend = np.linspace(0, base_demand * 0.15, N_DAYS)

    # Weekly seasonality: weekends higher for grocery/household, lower for electronics
    dow = dates.dayofweek
    if category == "electronics":
        weekly = np.where(dow >= 5, 1.15, 1.0)  # weekend bump (people browse gadgets)
    else:
        weekly = np.where(dow >= 5, 1.30, 1.0)  # bigger weekend bump for grocery/household

    # Monthly seasonality: mild boost around month-end (payday effect)
    day_of_month = dates.day
    monthly = 1.0 + 0.10 * (day_of_month >= 25)

    # Promotions: random ~10% of days, boosts demand ~40-70%
    promotion = np.random.binomial(1, 0.10, size=N_DAYS)
    promo_effect = 1.0 + promotion * np.random.uniform(0.4, 0.7, size=N_DAYS)

    # Price: mostly stable, occasional discount days (correlated with promotions)
    price = np.full(N_DAYS, base_price, dtype=float)
    price[promotion == 1] *= np.random.uniform(0.80, 0.90, size=promotion.sum())
    # Small random price drift on non-promo days
    price[promotion == 0] *= np.random.uniform(0.97, 1.03, size=(promotion == 0).sum())

    # Price elasticity: demand rises as price drops relative to base
    price_effect = (base_price / price) ** 0.8

    # Combine effects
    demand = (
        (base_demand + trend)
        * weekly
        * monthly
        * promo_effect
        * price_effect
    )

    # Add noise (Poisson-like, scaled) and clip at 0
    noise = np.random.normal(0, base_demand * 0.08, size=N_DAYS)
    demand = np.clip(np.round(demand + noise), 0, None).astype(int)

    return pd.DataFrame({
        "date": dates,
        "sku_id": sku_id,
        "demand": demand,
        "price": price.round(2),
        "promotion": promotion,
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="demand.csv")
    parser.add_argument("--start-date", default="2024-01-01")
    args = parser.parse_args()

    frames = [
        generate_sku_series(s["sku_id"], s["base_demand"], s["price"], s["category"], args.start_date)
        for s in SKUS
    ]
    df = pd.concat(frames, ignore_index=True)
    df = df.sort_values(["sku_id", "date"]).reset_index(drop=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df)} rows across {len(SKUS)} SKUs to {args.out}")
    print(df.head(10))


if __name__ == "__main__":
    main()
