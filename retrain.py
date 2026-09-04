import os
import pandas as pd
import numpy as np
import joblib
from xgboost import XGBRegressor

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def retrain_model(csv_path: str = None, model_path: str = None) -> bool:
    if csv_path is None:
        csv_path = os.path.join(_BASE_DIR, "demand_sample.csv")
    if model_path is None:
        model_path = os.path.join(_BASE_DIR, "model.pkl")
    """
    Reads the raw dataset, performs feature engineering, trains XGBoost,
    and overwrites model.pkl. Robust to various column formats and edge cases.
    """
    try:
        df = pd.read_csv(csv_path)
        if df.empty:
            print("Dataset is empty, skipping retrain.")
            return False

        # Ensure date is datetime
        df['date'] = pd.to_datetime(df['date'], errors='coerce')
        df['date'] = df['date'].fillna(pd.Timestamp.today())
        
        # Ensure price and promotion exist
        if 'price' not in df.columns:
            df['price'] = 100.0
        else:
            df['price'] = pd.to_numeric(df['price'], errors='coerce').fillna(100.0)

        if 'promotion' not in df.columns:
            df['promotion'] = 0
        else:
            df['promotion'] = pd.to_numeric(df['promotion'], errors='coerce').fillna(0).astype(int)

        if 'demand' not in df.columns:
            print("Missing 'demand' column in dataset.")
            return False
        df['demand'] = pd.to_numeric(df['demand'], errors='coerce').fillna(0)

        # Feature engineering (match what agent_tools will generate)
        df['year'] = df['date'].dt.year
        df['month'] = df['date'].dt.month
        df['day'] = df['date'].dt.day
        df['dayofweek'] = df['date'].dt.dayofweek
        
        # One-hot encode sku_id
        if 'sku_id' not in df.columns:
            df['sku_id'] = 'SKU_001'
        df['sku_id'] = df['sku_id'].astype(str)
        df = pd.get_dummies(df, columns=['sku_id'], dtype=int)
        
        # Define target and features
        y = df['demand']
        X = df.drop(columns=['date', 'demand'])
        X = X.apply(pd.to_numeric, errors='coerce').fillna(0)
        
        print(f"Training on features: {list(X.columns)} ({len(X)} samples)")
        
        # Train model
        model = XGBRegressor(
            n_estimators=min(100, max(20, len(X))),
            max_depth=min(6, max(3, int(np.log2(len(X) + 1)))),
            learning_rate=0.05,
            objective="reg:squarederror",
            random_state=42
        )
        model.fit(X, y)
        
        # Save raw model to be compatible with joblib.load
        joblib.dump(model, model_path)
        print(f"Successfully retrained and saved to {model_path}")
        return True
    except Exception as e:
        print(f"Failed to retrain model: {e}")
        return False

if __name__ == "__main__":
    retrain_model()
