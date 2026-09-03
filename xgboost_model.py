"""
Standalone XGBoost model module.

This isolates just the model itself — train, save, load, predict — so it
can be imported into a Flask/FastAPI endpoint or a notebook, separate from
the CSV-in/CSV-out pipeline in xgboost_forecast.py.

Usage as a script:
    python xgboost_model.py --train features.csv --target demand --save model.pkl

Usage as a module:
    from xgboost_model import DemandForecastModel
    model = DemandForecastModel()
    model.train(X_train, y_train)
    model.save("model.pkl")
    ...
    model = DemandForecastModel.load("model.pkl")
    preds = model.predict(X_new)
"""

import argparse
import joblib
import numpy as np
import pandas as pd
from xgboost import XGBRegressor
from sklearn.metrics import mean_absolute_error


class DemandForecastModel:
    """Thin wrapper around XGBRegressor with sensible defaults for
    short-history, tabular demand data (small hackathon-scale datasets)."""

    def __init__(self, **kwargs):
        params = dict(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            objective="reg:squarederror",
            random_state=42,
        )
        params.update(kwargs)  # allow overriding any default
        self.model = XGBRegressor(**params)
        self.feature_names_ = None

    def train(self, X: pd.DataFrame, y: pd.Series):
        self.feature_names_ = list(X.columns)
        self.model.fit(X, y)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        if self.feature_names_ is not None:
            X = X[self.feature_names_]  # enforce same column order as training
        preds = self.model.predict(X)
        return np.clip(preds, 0, None)  # demand can't be negative

    def evaluate(self, X: pd.DataFrame, y: pd.Series) -> dict:
        preds = self.predict(X)
        mae = mean_absolute_error(y, preds)
        return {"mae": mae, "predictions": preds}

    def feature_importance(self) -> pd.Series:
        return pd.Series(
            self.model.feature_importances_, index=self.feature_names_
        ).sort_values(ascending=False)

    def save(self, path: str):
        joblib.dump(self, path)

    @staticmethod
    def load(path: str) -> "DemandForecastModel":
        return joblib.load(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", required=True, help="CSV with features + target already engineered")
    parser.add_argument("--target", default="demand", help="Name of the target column")
    parser.add_argument("--save", default="model.pkl", help="Where to save the trained model")
    parser.add_argument("--test-frac", type=float, default=0.2)
    args = parser.parse_args()

    df = pd.read_csv(args.train)
    y = df[args.target]
    X = df.drop(columns=[args.target])

    cutoff = int(len(df) * (1 - args.test_frac))
    X_train, X_test = X.iloc[:cutoff], X.iloc[cutoff:]
    y_train, y_test = y.iloc[:cutoff], y.iloc[cutoff:]

    model = DemandForecastModel()
    model.train(X_train, y_train)

    result = model.evaluate(X_test, y_test)
    print(f"Test MAE: {result['mae']:.3f}")
    print("\nTop features:")
    print(model.feature_importance().head(10))

    model.save(args.save)
    print(f"\nModel saved to {args.save}")


if __name__ == "__main__":
    main()