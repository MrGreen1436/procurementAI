from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import plotly.graph_objs as go
import pandas as pd
import numpy as np
import os
from time_series_service import ProphetForecastingService, ETSForecastingService
from xgboost_model import DemandForecastModel
from procurement_engine import IndustrialProcurementEngine
from pydantic import BaseModel

app = FastAPI(title="Demand Forecasting API", description="API to forecast product demand using XGBoost, Prophet, or ETS")

class ForecastRequest(BaseModel):
    sku_id: str
    days: int = 14

app.mount("/static", StaticFiles(directory="public"), name="static")

@app.get("/")
def read_root():
    return FileResponse("public/index.html")

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(content=b"", media_type="image/x-icon")

def create_plot_html(sku_id, history_df, forecast_df, model_name):
    fig = go.Figure()

    # Historical demand
    fig.add_trace(go.Scatter(
        x=history_df['date'],
        y=history_df['demand'],
        mode='lines',
        name='Historical Demand',
        line=dict(color='blue')
    ))

    # Forecasted demand
    date_col = 'ds' if model_name == 'Prophet' else 'date'
    val_col = 'yhat' if model_name == 'Prophet' else 'forecast_demand'

    fig.add_trace(go.Scatter(
        x=forecast_df[date_col],
        y=forecast_df[val_col],
        mode='lines',
        name='Forecasted Demand',
        line=dict(color='orange', dash='dash')
    ))

    # Add uncertainty intervals for Prophet
    if model_name == 'Prophet' and 'yhat_upper' in forecast_df.columns:
        fig.add_trace(go.Scatter(
            x=pd.concat([forecast_df[date_col], forecast_df[date_col][::-1]]),
            y=pd.concat([forecast_df['yhat_upper'], forecast_df['yhat_lower'][::-1]]),
            fill='toself',
            fillcolor='rgba(255,165,0,0.2)',
            line=dict(color='rgba(255,255,255,0)'),
            name='Confidence Interval'
        ))

    fig.update_layout(
        title=f"{model_name} Forecast for {sku_id}",
        xaxis_title="Date",
        yaxis_title="Demand",
        template="plotly_white"
    )
    return fig.to_html(full_html=True)


@app.post("/forecast/prophet")
def forecast_prophet(request: ForecastRequest):
    if not os.path.exists("demand_sample.csv"):
        raise HTTPException(status_code=404, detail="Dataset demand_sample.csv not found. Please upload or generate it first.")
        
    df = pd.read_csv("demand_sample.csv")
    sku_data = df[df['sku_id'] == request.sku_id]
    
    if sku_data.empty:
        raise HTTPException(status_code=404, detail=f"No data found for sku_id: {request.sku_id}")
    
    # Initialize Prophet (we'll ignore regressors for this simple endpoint since we don't know future regressors)
    model = ProphetForecastingService()
    
    # Fit
    try:
        model.fit(sku_data, date_col="date", target_col="demand")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fitting Prophet model: {str(e)}")
    
    # Predict
    forecast = model.predict(periods=request.days)
    
    # Convert 'ds' to string for JSON serialization
    forecast['ds'] = forecast['ds'].dt.strftime('%Y-%m-%d')
    
    return {
        "sku_id": request.sku_id,
        "forecast": forecast.to_dict(orient="records")
    }

@app.post("/forecast/ets")
def forecast_ets(request: ForecastRequest):
    if not os.path.exists("demand_sample.csv"):
        raise HTTPException(status_code=404, detail="Dataset demand_sample.csv not found.")
        
    df = pd.read_csv("demand_sample.csv")
    sku_data = df[df['sku_id'] == request.sku_id]
    
    if sku_data.empty:
        raise HTTPException(status_code=404, detail=f"No data found for sku_id: {request.sku_id}")
    
    # Initialize ETS
    model = ETSForecastingService(seasonal_periods=7)
    
    # Fit
    try:
        model.fit(sku_data, date_col="date", target_col="demand")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fitting ETS model: {str(e)}")
    
    # Predict
    forecast = model.predict(steps=request.days)
    
    # Convert dates for JSON
    forecast['date'] = forecast['date'].dt.strftime('%Y-%m-%d')
    
    return {
        "sku_id": request.sku_id,
        "forecast": forecast.to_dict(orient="records")
    }

@app.get("/plot/prophet", response_class=HTMLResponse)
def plot_prophet(sku_id: str = "SKU_001", days: int = 14):
    if not os.path.exists("demand_sample.csv"):
        return "<h1>Dataset not found</h1>"
    df = pd.read_csv("demand_sample.csv")
    sku_data = df[df['sku_id'] == sku_id]
    if sku_data.empty:
        return f"<h1>No data for {sku_id}</h1>"
    
    model = ProphetForecastingService()
    model.fit(sku_data, date_col="date", target_col="demand")
    forecast = model.predict(periods=days)
    
    html = create_plot_html(sku_id, sku_data, forecast, "Prophet")
    return HTMLResponse(content=html)

@app.get("/plot/ets", response_class=HTMLResponse)
def plot_ets(sku_id: str = "SKU_001", days: int = 14):
    if not os.path.exists("demand_sample.csv"):
        return "<h1>Dataset not found</h1>"
    df = pd.read_csv("demand_sample.csv")
    sku_data = df[df['sku_id'] == sku_id]
    if sku_data.empty:
        return f"<h1>No data for {sku_id}</h1>"
    
    model = ETSForecastingService(seasonal_periods=7)
    model.fit(sku_data, date_col="date", target_col="demand")
    forecast = model.predict(steps=days)
    
    html = create_plot_html(sku_id, sku_data, forecast, "ETS")
    return HTMLResponse(content=html)

@app.get("/api/procurement")
def get_procurement_dashboard(sku_id: str = "SKU_001"):
    if not os.path.exists("demand_sample.csv"):
        raise HTTPException(status_code=404, detail="Dataset not found")
        
    df = pd.read_csv("demand_sample.csv")
    sku_data = df[df['sku_id'] == sku_id]
    if sku_data.empty:
        raise HTTPException(status_code=404, detail=f"No data for {sku_id}")
        
    # Get Unit Cost (Base Price) and Lead time
    unit_cost = float(sku_data['price'].iloc[-1])
    lead_time_days = 10 # Example lead time
    
    # We pretend current inventory is somewhat low for the demo
    # e.g., slightly above safety stock to make it interesting
    
    # Forecast next 14 days
    model = ProphetForecastingService()
    model.fit(sku_data, date_col="date", target_col="demand")
    forecast = model.predict(periods=14)
    forecast_values = forecast['yhat'].values
    
    engine = IndustrialProcurementEngine()
    current_inventory = np.sum(forecast_values[:5]) # just a mock value to ensure reorder is triggered
    
    procurement_metrics = engine.generate_procurement_recommendation(
        forecasted_daily_demand=forecast_values,
        current_inventory=current_inventory,
        lead_time_days=lead_time_days,
        unit_cost=unit_cost
    )
    
    # Ensure all values in metrics dictionary are standard Python types (bool, int, float, str)
    clean_metrics = {}
    for k, v in procurement_metrics.items():
        if isinstance(v, (bool, np.bool_)):
            clean_metrics[k] = bool(v)
        elif isinstance(v, (int, np.integer)):
            clean_metrics[k] = int(v)
        elif isinstance(v, (float, np.floating)):
            clean_metrics[k] = float(v)
        else:
            clean_metrics[k] = str(v)
    
    # Convert dates and values to clean python lists
    dates_hist = [str(d) for d in sku_data['date']]
    demand_hist = [int(v) for v in sku_data['demand']]
    
    dates_fc = [str(d) for d in forecast['ds'].dt.strftime('%Y-%m-%d')]
    demand_fc = [float(v) for v in forecast['yhat']]
    lower_fc = [float(v) for v in forecast['yhat_lower']]
    upper_fc = [float(v) for v in forecast['yhat_upper']]
    
    return {
        "sku_id": str(sku_id),
        "metrics": clean_metrics,
        "history": {
            "dates": dates_hist,
            "demand": demand_hist
        },
        "forecast": {
            "dates": dates_fc,
            "demand": demand_fc,
            "lower": lower_fc,
            "upper": upper_fc
        }
    }
