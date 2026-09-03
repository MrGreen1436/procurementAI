async function fetchProcurementData() {
    const skuId = document.getElementById('skuInput').value.trim();
    if (!skuId) return;

    // Loading State
    const btn = document.querySelector('button');
    const originalText = btn.innerText;
    btn.innerText = 'Analyzing...';
    btn.disabled = true;
    
    try {
        const response = await fetch(`/api/procurement?sku_id=${skuId}`);
        if (!response.ok) {
            throw new Error('Data not found for this SKU');
        }
        
        const data = await response.json();
        updateDashboard(data);
    } catch (error) {
        alert(error.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function updateDashboard(data) {
    const metrics = data.metrics;
    
    // Update Metrics
    document.getElementById('valInventory').innerText = metrics.current_inventory;
    document.getElementById('valROP').innerText = metrics.reorder_point;
    document.getElementById('valSafetyStock').innerText = metrics.safety_stock;
    
    if (metrics.trigger_purchase_order) {
        document.getElementById('valAction').innerText = `Order ${metrics.recommended_order_quantity} Units`;
        document.getElementById('valCost').innerText = `Estimated Cost: $${metrics.estimated_cost}`;
        document.getElementById('actionCard').style.borderColor = 'rgba(239, 68, 68, 0.5)';
        document.getElementById('actionCard').style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(185, 28, 28, 0.2))';
    } else {
        document.getElementById('valAction').innerText = `Stock Level OK`;
        document.getElementById('valCost').innerText = `No action required`;
        document.getElementById('actionCard').style.borderColor = 'rgba(16, 185, 129, 0.5)';
        document.getElementById('actionCard').style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(4, 120, 87, 0.2))';
    }

    // Update Status Banner
    const banner = document.getElementById('statusBanner');
    const badge = document.getElementById('urgencyBadge');
    const msg = document.getElementById('statusMessage');
    
    banner.className = `status-banner ${metrics.urgency.toLowerCase()}`;
    badge.className = `urgency-badge ${metrics.urgency.toLowerCase()}`;
    badge.innerText = `URGENCY: ${metrics.urgency}`;
    
    if (metrics.urgency === 'HIGH') {
        msg.innerText = `CRITICAL: Inventory has fallen below safety stock. Order ${metrics.recommended_order_quantity} units immediately.`;
    } else if (metrics.urgency === 'MEDIUM') {
        msg.innerText = `WARNING: Inventory is at or below the reorder point. Prepare to order ${metrics.recommended_order_quantity} units.`;
    } else {
        msg.innerText = `ALL GOOD: Current inventory levels are sufficient for the forecasted lead time.`;
    }

    // Render Plotly Chart
    renderChart(data);
}

function renderChart(data) {
    const history = data.history;
    const forecast = data.forecast;
    
    const trace1 = {
        x: history.dates,
        y: history.demand,
        mode: 'lines',
        name: 'Historical Demand',
        line: { color: '#3b82f6', width: 2 }
    };
    
    const trace2 = {
        x: forecast.dates,
        y: forecast.demand,
        mode: 'lines',
        name: 'Forecasted Demand',
        line: { color: '#f59e0b', width: 2, dash: 'dash' }
    };
    
    // Confidence Intervals
    const trace3 = {
        x: forecast.dates.concat(forecast.dates.slice().reverse()),
        y: forecast.upper.concat(forecast.lower.slice().reverse()),
        fill: 'toself',
        fillcolor: 'rgba(245, 158, 11, 0.1)',
        line: { color: 'transparent' },
        name: 'Confidence Interval',
        showlegend: false
    };
    
    const layout = {
        title: {
            text: `${data.sku_id} Demand Forecast`,
            font: { color: '#f8fafc', family: 'Inter' }
        },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#94a3b8', family: 'Inter' },
        xaxis: {
            gridcolor: 'rgba(255, 255, 255, 0.05)',
            zerolinecolor: 'rgba(255, 255, 255, 0.05)'
        },
        yaxis: {
            gridcolor: 'rgba(255, 255, 255, 0.05)',
            zerolinecolor: 'rgba(255, 255, 255, 0.05)',
            title: 'Units Demanded'
        },
        margin: { t: 50, r: 20, l: 50, b: 50 },
        legend: { orientation: 'h', y: -0.2 }
    };
    
    Plotly.newPlot('forecastPlot', [trace3, trace1, trace2], layout, {responsive: true});
}

// Initial load for default SKU
document.addEventListener('DOMContentLoaded', () => {
    fetchProcurementData();
});
