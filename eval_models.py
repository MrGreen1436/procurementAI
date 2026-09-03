import pandas as pd
import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error
from time_series_service import ProphetForecastingService, ETSForecastingService
from xgboost_model import DemandForecastModel
from plot_forecast import engineer_features
import warnings

warnings.filterwarnings("ignore")

def mape(y_true, y_pred):
    """Mean Absolute Percentage Error."""
    # Prevent division by zero
    y_true, y_pred = np.array(y_true), np.array(y_pred)
    non_zero = y_true != 0
    return np.mean(np.abs((y_true[non_zero] - y_pred[non_zero]) / y_true[non_zero])) * 100

def evaluate_models_for_sku(sku_id: str = "SKU_001", test_days: int = 30):
    df = pd.read_csv("demand_sample.csv")
    sku_data = df[df['sku_id'] == sku_id].sort_values("date").reset_index(drop=True)
    
    cutoff = len(sku_data) - test_days
    train_df = sku_data.iloc[:cutoff]
    test_df = sku_data.iloc[cutoff:]
    
    actuals = test_df['demand'].values
    results = {}
    
    # --- 1. Prophet ---
    print(f"Training Prophet for {sku_id}...")
    p_service = ProphetForecastingService()
    p_service.fit(train_df, date_col="date", target_col="demand")
    # Prophet's predict returns both historical and future dates; slice the last `test_days`
    p_preds = p_service.predict(periods=test_days)['yhat'].values[-test_days:]
    
    results['Prophet'] = {
        "MAE": mean_absolute_error(actuals, p_preds),
        "RMSE": np.sqrt(mean_squared_error(actuals, p_preds)),
        "MAPE (%)": mape(actuals, p_preds)
    }
    
    # --- 2. ETS ---
    print(f"Training ETS for {sku_id}...")
    ets_service = ETSForecastingService(seasonal_periods=7)
    ets_service.fit(train_df, date_col="date", target_col="demand")
    ets_preds = ets_service.predict(steps=test_days)['forecast_demand'].values
    
    results['ETS'] = {
        "MAE": mean_absolute_error(actuals, ets_preds),
        "RMSE": np.sqrt(mean_squared_error(actuals, ets_preds)),
        "MAPE (%)": mape(actuals, ets_preds)
    }
    
    # --- 3. XGBoost ---
    print(f"Training XGBoost for {sku_id}...")
    df_eng = engineer_features(df.copy())
    # Filter for the specific SKU using the one-hot encoded column created by engineer_features
    # Note: engineer_features does pd.get_dummies(columns=['sku_id'])
    sku_col = f'sku_id_{sku_id}'
    
    if sku_col in df_eng.columns:
        df_eng = df_eng[df_eng[sku_col] == 1].drop(columns=['date'])
    else:
        # Fallback if one hot encoding didn't create this column (e.g. sku_id wasn't in original df passed to get_dummies)
        pass # In our case we know it's there
        
    X = df_eng.drop(columns=['demand'])
    y = df_eng['demand']
    
    X_train, X_test = X.iloc[:cutoff], X.iloc[cutoff:]
    y_train, y_test = y.iloc[:cutoff], y.iloc[cutoff:]
    
    xgb_model = DemandForecastModel()
    xgb_model.train(X_train, y_train)
    xgb_preds = xgb_model.predict(X_test)
    
    results['XGBoost'] = {
        "MAE": mean_absolute_error(y_test, xgb_preds),
        "RMSE": np.sqrt(mean_squared_error(y_test, xgb_preds)),
        "MAPE (%)": mape(y_test.values, xgb_preds)
    }
    
    res_df = pd.DataFrame(results).T.round(2)
    print(f"\n=== Model Cross-Verification for {sku_id} (Last {test_days} Days) ===")
    print(res_df)
    return res_df

if __name__ == "__main__":
    evaluate_models_for_sku("SKU_001")
