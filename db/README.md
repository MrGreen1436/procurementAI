# ProcurementAI ΓÇö Database Layer

This folder contains the Node.js scripts used to set up and seed the Supabase database for the ProcurementAI project.

## Schema Overview

| Table / View | Purpose |
|---|---|
| `vendors` | Supplier reference data (supplier_id PK, name, phone) |
| `inventory_transactions` | 73,100 enriched inventory records from CSV |
| `purchase_orders` | AI-generated POs with approval status and audit trail |
| `alerts` | Live VIEW ΓÇö flags SKUs below reorder level by risk |
| `chat_logs` | Stores Q&A from the AI assistant with citations (jsonb) |
| `scenario_runs` | Stores what-if simulation results with affected SKUs (jsonb) |
| `audit_log` | Append-only log of all approve/reject/edit actions |

## Scripts

### `import_inventory.js`
Reads `data/retail_store_inventory.csv` and bulk-inserts into `inventory_history` (legacy, 500-row batches).

### `import_enriched.js`
Two-pass import from `data/retail_store_inventory_enriched.csv`:
1. Upserts unique vendors into `vendors`
2. Bulk-inserts all rows into `inventory_transactions` (500-row batches)

### `seed_pos.js`
- Seeds 5 demo vendors into `vendors`
- Queries top-5 highest-risk SKUs from `inventory_transactions`
- Inserts a `purchase_order` per SKU with AI-generated rationale fields

## Environment Variables

```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

## Usage

```powershell
npm install
$env:SUPABASE_URL="..."
$env:SUPABASE_SERVICE_ROLE_KEY="..."
node import_enriched.js   # load inventory data
node seed_pos.js          # seed vendors + purchase orders
```
