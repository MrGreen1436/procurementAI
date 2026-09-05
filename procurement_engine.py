import numpy as np

class IndustrialProcurementEngine:
    def __init__(self):
        # We don't load the model here directly since we want to pass the predictions dynamically
        # from our existing time_series_service (Prophet).
        pass
        
    def generate_procurement_recommendation(
        self,
        forecasted_daily_demand: np.ndarray,
        current_inventory: float,
        lead_time_days: int,
        unit_cost: float,
        service_level_z: float = 1.65  # 95% service level
    ) -> dict:
        """
        Calculates procurement metrics based on forecasted demand.
        forecasted_daily_demand: Array of forecasted values for the next N days.
        """
        if len(forecasted_daily_demand) < lead_time_days:
            # Fallback if forecast is shorter than lead time
            total_lead_time_demand = np.sum(forecasted_daily_demand)
        else:
            total_lead_time_demand = np.sum(forecasted_daily_demand[:lead_time_days])
            
        avg_daily_demand = np.mean(forecasted_daily_demand)
        
        # 2. Calculate Safety Stock & Reorder Point
        demand_std = np.std(forecasted_daily_demand) if len(forecasted_daily_demand) > 1 else 0
        safety_stock = int(service_level_z * demand_std * np.sqrt(lead_time_days))
        reorder_point = int(total_lead_time_demand + safety_stock)
        
        # 3. Decision Logic: Trigger Purchase Order?
        needs_reorder = current_inventory <= reorder_point
        # Order quantity to bring stock back up to 1.5x reorder point (common min-max inventory logic)
        target_inventory = max(int(reorder_point * 1.5), reorder_point + int(avg_daily_demand * lead_time_days))
        recommended_order_qty = max(0, target_inventory - current_inventory) if needs_reorder else 0
        total_procurement_cost = recommended_order_qty * unit_cost
        
        urgency = "LOW"
        if current_inventory <= safety_stock:
            urgency = "HIGH"
        elif needs_reorder:
            urgency = "MEDIUM"
            
        TAX_RATE = 0.18
        subtotal    = float(round(total_procurement_cost, 2))
        tax_amount  = float(round(subtotal * TAX_RATE, 2))
        total_cost  = float(round(subtotal + tax_amount, 2))

        return {
            "current_inventory": int(current_inventory),
            "reorder_point": int(reorder_point),
            "safety_stock": int(safety_stock),
            "trigger_purchase_order": bool(needs_reorder),
            "recommended_order_quantity": int(recommended_order_qty),
            # Itemised cost breakdown
            "subtotal": subtotal,
            "tax_rate": TAX_RATE,
            "tax_amount": tax_amount,
            "total_cost": total_cost,
            # Kept for backward-compatibility with callers that read estimated_cost
            "estimated_cost": total_cost,
            "urgency": str(urgency),
            "total_lead_time_demand": int(total_lead_time_demand)
        }
