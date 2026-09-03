import os
import pandas as pd
import joblib
from xgboost import XGBRegressor

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def retrain_model(csv_path: str = None, model_path: str = None):
    if csv_path is None:
        csv_path = os.path.join(_BASE_DIR, "demand_sample.csv")
    if model_path is None:
        model_path = os.path.join(_BASE_DIR, "model.pkl")
    """
    Reads the raw dataset, performs feature engineering, trains XGBoost,
    and overwrites model.pkl.
    """
    try:
        df = pd.read_csv(csv_path)
        
        # Ensure date is datetime
        df['date'] = pd.to_datetime(df['date'])
        
        # Feature engineering (match what agent_tools will generate)
        df['year'] = df['date'].dt.year
        df['month'] = df['date'].dt.month
        df['day'] = df['date'].dt.day
        df['dayofweek'] = df['date'].dt.dayofweek
        
        # One-hot encode sku_id
        df = pd.get_dummies(df, columns=['sku_id'], dtype=int)
        
        # Define target and features
        y = df['demand']
        X = df.drop(columns=['date', 'demand'])
        
        print(f"Training on features: {list(X.columns)}")
        
        # Train model
        model = XGBRegressor(
            n_estimators=100,
            max_depth=6,
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
