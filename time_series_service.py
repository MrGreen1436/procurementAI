import pandas as pd
import numpy as np
from prophet import Prophet
from statsmodels.tsa.exponential_smoothing.ets import ETSModel
import warnings

# Suppress some verbose Prophet/Statsmodels warnings for cleaner output
warnings.filterwarnings("ignore")

class ProphetForecastingService:
    """Wrapper for Meta Prophet Forecasting."""
    
    def __init__(self, yearly_seasonality=True, weekly_seasonality=True, daily_seasonality=False):
        self.model = Prophet(
            yearly_seasonality=yearly_seasonality,
            weekly_seasonality=weekly_seasonality,
            daily_seasonality=daily_seasonality
        )
        
    def add_regressor(self, name: str):
        """Add exogenous features like price or promotions."""
        self.model.add_regressor(name)
        
    def fit(self, df: pd.DataFrame, date_col: str = "date", target_col: str = "demand"):
        """Prophet expects 'ds' for date and 'y' for target value."""
        prophet_df = df.rename(columns={date_col: "ds", target_col: "y"})
        self.model.fit(prophet_df)
        return self

    def predict(self, periods: int, freq: str = "D", future_df: pd.DataFrame = None) -> pd.DataFrame:
        """Forecast `periods` days into the future."""
        if future_df is None:
            future_df = self.model.make_future_dataframe(periods=periods, freq=freq)
        
        forecast = self.model.predict(future_df)
        # Ensure predicted demand is non-negative
        forecast['yhat'] = forecast['yhat'].clip(lower=0)
        return forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']]


class ETSForecastingService:
    """Wrapper for Statsmodels ETS (Error, Trend, Seasonal) Exponential Smoothing."""
    
    def __init__(self, error="add", trend="add", seasonal="add", seasonal_periods=7):
        self.error = error
        self.trend = trend
        self.seasonal = seasonal
        self.seasonal_periods = seasonal_periods
        self.model_fit = None

    def fit(self, df: pd.DataFrame, date_col: str = "date", target_col: str = "demand"):
        """Fits ETS model on a continuous time series indexed by date."""
        # Convert date to datetime and set as index
        df_copy = df.copy()
        df_copy[date_col] = pd.to_datetime(df_copy[date_col])
        ts = df_copy.set_index(date_col)[target_col]
        
        # Ensure frequency is Daily and forward-fill any missing dates
        ts = ts.asfreq('D')
        ts = ts.ffill()
        
        model = ETSModel(
            ts,
            error=self.error,
            trend=self.trend,
            seasonal=self.seasonal,
            seasonal_periods=self.seasonal_periods
        )
        self.model_fit = model.fit(disp=False)
        return self

    def predict(self, steps: int) -> pd.DataFrame:
        """Forecast `steps` into the future."""
        forecast = self.model_fit.forecast(steps=steps)
        forecast = forecast.clip(lower=0)  # Demand can't be negative
        
        return pd.DataFrame({
            "date": forecast.index,
            "forecast_demand": forecast.values
        })
