import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import os
from xgboost_model import DemandForecastModel

def engineer_features(df):
    df['date'] = pd.to_datetime(df['date'])
    df['day_of_week'] = df['date'].dt.dayofweek
    df['day_of_month'] = df['date'].dt.day
    df['month'] = df['date'].dt.month
    
    # One-hot encode SKU
    df = pd.get_dummies(df, columns=['sku_id'])
    
    return df

def main():
    df = pd.read_csv("demand_sample.csv")
    
    # Keep original dates and skus for plotting
    dates = pd.to_datetime(df['date'])
    skus = df['sku_id']
    
    # Feature engineering
    df_engineered = engineer_features(df.copy())
    df_engineered = df_engineered.drop(columns=['date'])
    
    # Sort chronologically (assuming the original data is sorted or date-based)
    # Actually, let's sort by date first to do chronological split properly
    df_engineered['date'] = dates
    df_engineered = df_engineered.sort_values(['date']).reset_index(drop=True)
    df_sorted_dates = df_engineered['date']
    df_engineered = df_engineered.drop(columns=['date'])
    
    target = 'demand'
    y = df_engineered[target]
    X = df_engineered.drop(columns=[target])
    
    # Split
    cutoff = int(len(df_engineered) * 0.8)
    X_train, X_test = X.iloc[:cutoff], X.iloc[cutoff:]
    y_train, y_test = y.iloc[:cutoff], y.iloc[cutoff:]
    dates_train, dates_test = df_sorted_dates.iloc[:cutoff], df_sorted_dates.iloc[cutoff:]
    
    model = DemandForecastModel(n_estimators=300)
    model.train(X_train, y_train)
    
    # Evaluate
    result = model.evaluate(X_test, y_test)
    preds = result['predictions']
    print(f"Test MAE: {result['mae']:.3f}")
    
    # Plotting
    plt.figure(figsize=(14, 6))
    
    # We plot the test set
    plt.plot(dates_test, y_test.values, label='Actual Demand', alpha=0.7)
    plt.plot(dates_test, preds, label='Forecasted Demand', alpha=0.7, linestyle='--')
    
    plt.title('Actual vs Forecasted Demand (Test Set)')
    plt.xlabel('Date')
    plt.ylabel('Demand')
    plt.legend()
    plt.grid(True)
    
    # Save the plot
    artifact_dir = os.path.join(os.getenv("APPDATA") or os.environ.get("USERPROFILE") + "\\.gemini\\antigravity-ide", "brain", "4c3260b1-c8bd-4f36-9dc1-1235340a85cc", "scratch")
    os.makedirs(artifact_dir, exist_ok=True)
    plot_path = os.path.join(artifact_dir, "forecast_plot.png")
    
    # In Windows, we can also just save to cwd and copy later if needed.
    # Let's save directly to the cwd as well for easy access.
    local_plot = "forecast_plot.png"
    plt.savefig(local_plot, bbox_inches='tight')
    plt.savefig(plot_path, bbox_inches='tight')
    
    print(f"Plot saved to {local_plot}")

if __name__ == "__main__":
    main()
