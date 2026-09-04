# Project Architecture, Status & AI Hand-off Guide

> **Project Name**: Procurement AI Agent (`procure-ai`)  
> **Target Context**: Hackathon end-to-end autonomous procurement & inventory risk mitigation system  
> **Current Date**: September 2026  

---

## 1. Executive Summary & Core Objective

The **AI Procurement Agent** is an end-to-end intelligent supply chain management system designed to:
1. **Forecast Demand & Detect Stockout Risks**: Uses machine learning (XGBoost) trained on historical demand to predict stockouts before they occur.
2. **Execute a 3-Stage Autonomous Decision Engine**:
   - **Stage 1 (Internal Verification)**: Calculates inventory confidence score based on recency, stock ratio, and count mismatches.
   - **Stage 2 (Decision Gate)**: Decides whether to:
     - `Use Internal Stock`: Transfer surplus from nearby sites (skips external buying).
     - `Verify Manually First`: Put PO on hold with `pending_approval` flag.
     - `Proceed with Procurement`: Escalate to external supplier purchasing.
   - **Stage 3 (LLM Multi-Turn Tool Calling)**: Calls LLM (Gemini 2.0 Flash) with function tools to weigh supplier lead times, prices, and reliability scores to create purchase orders.
3. **Automate Purchasing with Strict Business Rules**: Python-enforced threshold (`total_cost < $5,000` is `auto_approved`, otherwise `pending_approval`).
4. **Idempotent Human-in-the-Loop Approvals**: Guard against duplicate approvals/rejections using an internal `feedback_applied` lock.
5. **Grounded Natural Language Assistant**: `/query` endpoint answers questions using live data and read-only tools with anti-hallucination prompts.
6. **Supplier Communication Integration**: `/email/parse` parses delays from unstructured emails and re-triggers the agent.

---

## 2. Technology Stack & Running Services

### **Frontend**
- **Framework**: Next.js 16.3.4 (App Router), React 19.2.8, TypeScript
- **Styling**: TailwindCSS v4, Tremor React, Lucide Icons, Sonner toasts
- **Port**: `http://localhost:3000` (Dev server command: `npm run dev`)

### **Backend**
- **Framework**: FastAPI (Python 3.11), Uvicorn, Pydantic v2
- **ML / Data**: XGBoost, Scikit-learn, Pandas, NumPy, Joblib
- **LLM SDK**: `google-genai` (Gemini 2.0 Flash) with automated rule-based fallback
- **Port**: `http://localhost:8000` (Swagger docs: `http://localhost:8000/docs`)
- **Start Command**: `python -m uvicorn main:app --reload --port 8000`

---

## 3. Detailed File-by-File Breakdown

### Backend Core

#### `models.py`
Pydantic schemas defining all data models across the system:
- `InventoryItem`: SKU ID, site ID, current stock, reorder point, plus **Decision Engine fields**:
  - `hours_since_update` (float, default 12.0)
  - `mismatch_count` (int, default 0)
  - `in_stock_at_other_site` (bool, default False)
  - `retrieval_minutes` (int, default 60)
- `ForecastResult`: Predicted demand over `horizon_days` with confidence intervals.
- `Supplier`: Supplier ID, name, unit price, lead time, and reliability score (0 to 1).
- `RiskAlert`: Alerts with severity (`low`, `medium`, `high`) and predicted stockout date.
- `PurchaseOrder`: ID, supplier ID, line items, total cost, reasoning, status (`auto_approved`, `pending_approval`, `rejected`), `generated_by` (`llm` | `fallback`), `created_at`, and `feedback_applied: bool` (hidden internal field for idempotency).
- `QueryRequest` / `QueryResponse`: Question input and answer + `tools_used`.
- `EmailParseRequest` / `EmailParseResult`: Unstructured email text input and structured supplier/delay output.

#### `store.py`
Shared in-memory state (avoids circular dependencies between `main.py` and `agent_tools.py`):
- `MOCK_INVENTORY: dict[str, InventoryItem]`
- `MOCK_SUPPLIERS: dict[str, list[Supplier]]`
- `MOCK_POS: dict[str, PurchaseOrder]`
- `RISK_ALERTS: list[RiskAlert]`
- `load_state_from_csv(csv_path)`: Dynamically seeds inventory and suppliers from `demand_sample.csv` or uploaded datasets.

#### `agent_tools.py`
Callable functions registered as Gemini Function Calling schemas:
- `get_inventory(sku_id)`: Fetches SKU stock and reorder point.
- `get_forecast(sku_id, horizon_days=30)`: Predicts future demand using the loaded `model.pkl` (XGBoost) with fallback.
- `get_suppliers(sku_id)`: Returns available suppliers, pricing, and reliability.
- `get_supplier_performance(supplier_id)`: Returns specific supplier profile.
- `get_risk_alerts(risk_level)`: Filters active risk alerts.
- `create_purchase_order(items, supplier_id, reasoning)`: Validates items, calculates total, applies cost rules, and persists to `MOCK_POS`.
- Tool collections:
  - `AGENT_TOOL`: All tools (used in `/agent/run`).
  - `QUERY_TOOL`: Read-only tools only (excludes `create_purchase_order` to prevent unintended PO generation).
  - `EMAIL_TOOL`: Forced `extract_email_info` tool for structured extraction.

#### `main.py`
FastAPI application router and orchestration logic:
- **Decision Engine Implementation**:
  - `compute_inventory_confidence(item)`: Scores 0-100 based on hours since verification, stock-to-reorder ratio, and mismatch history.
  - `make_procurement_decision(confidence_score, retrieval_minutes, in_stock)`:
    - `>= 70` confidence & `<= 30` min retrieval & `in_stock` → **"Use Internal Stock"** (Transfer recommended, no PO).
    - `>= 40` confidence or `> 30` min retrieval & `in_stock` → **"Verify Manually First"** (Creates PO locked in `pending_approval`).
    - Otherwise → **"Proceed with Procurement"** (Escalates to LLM or rule-based fallback).
- **Agent Execution (`POST /agent/run`)**:
  - Filters high-risk alerts.
  - Passes each through the Decision Engine.
  - Runs Gemini multi-turn tool calling loop or `_fallback_create_po`.
  - Python-enforces `$5,000` auto-approval threshold.
  - Returns `created_pos`, `transfer_recommendations`, and execution `mode`.
- **Grounded Assistant (`POST /query`)**:
  - Uses `build_grounded_prompt()` to inject live metrics (active alerts, highest risk, latest forecast) directly into system prompt.
  - Constrains response strictly to tool-verified procurement data.
- **Email Parser (`POST /email/parse`)**:
  - Extracts supplier, SKU, delay days.
  - Automatically triggers `run_agent()` to update procurement recommendations.
- **Idempotent Approvals (`POST /agent/approve/{id}` & `/reject/{id}`)**:
  - Checks `po.feedback_applied`. If true, immediately returns `{"status": "skipped", "reason": "already applied"}`.
  - Sets state change first, marks `feedback_applied = True` second (crash-safe ordering).
- **Dynamic Endpoints**:
  - `/kpis`: Real-time stockout risk count, excess inventory value, open POs, supplier risk score.
  - `/alerts`: Dynamic alert generator computed from current stock vs forecasted 30-day demand.
  - `/inventory-history`: Last 90 days of actual demand + model forecast curve.
  - `/upload-dataset`: Uploads new CSV, triggers `retrain.py`, reloads store, and updates models live.

#### Supporting Python Files
- `retrain.py`: Automatically trains a new XGBoost model on uploaded CSV data and writes `model.pkl`.
- `xgboost_model.py`: Model architecture, feature engineering (year, month, day, dayofweek, one-hot SKU encoding).
- `procurement_engine.py`: Industrial safety-stock and reorder point calculation utilities using Z-scores (95% service level).

---

### Frontend Core

- **`app/page.tsx` (Dashboard)**:
  - KPI summary metrics (Stockout risks, Excess inventory, Open POs, Supplier risk).
  - Risk Alerts table with severity badges.
  - Dynamic interactive Recharts graph showing actual demand vs forecasted demand.
  - CSV dataset upload widget (re-trains ML model on the fly).
- **`app/po-queue/page.tsx` (Purchase Order Approval Queue)**:
  - Lists all pending, approved, and rejected POs.
  - Shows agent explanations ("Why Supplier", "Why Quantity", "Why Cost").
  - One-click Approve / Reject buttons interacting with the backend API.
- **`app/simulator/page.tsx` (Scenario Simulator)**:
  - What-if analysis for supply chain shocks (demand surges, supplier delays, lead time spikes).
- **`app/chat/page.tsx` (AI Procurement Copilot)**:
  - Conversational chat UI connecting to `POST /query`.
- **`lib/api.ts`**:
  - Handles client-side API requests to `http://127.0.0.1:8000`.
  - Includes graceful fallback to `mockData.ts` if the backend is temporarily unreachable.

---

## 4. Current State: What Works vs. Known Caveats

### ✅ Fully Working & Verified
1. **FastAPI Backend Server**: Running on `http://127.0.0.1:8000` with full CORS support.
2. **Next.js Frontend Server**: Running on `http://localhost:3000`.
3. **Startup Automated Seeding**: Generates baseline POs from inventory state on startup.
4. **Decision Engine Logic**:
   - Verification scoring & transfer recommendations working.
   - Manual verification hold working.
5. **Idempotency Guard**: Repeated `/agent/approve/{id}` or `/agent/reject/{id}` returns HTTP 200 with `status: "skipped"`.
6. **Error Handling**: Non-existent SKUs, suppliers, or POs return clean HTTP 404 responses.
7. **Rule-Based Fallback**: Full operational capability even if no Gemini API key is configured.
8. **Dynamic CSV Upload & ML Retraining**: Endpoint `/upload-dataset` processes CSVs and retrains XGBoost on the fly.
9. **Automated Integration Tests**: `test_integration.py` and `smoke_test.py` execute end-to-end without errors.

### ⚠️ Current Caveats & Operating Modes
1. **Gemini API Key**:
   - If `GEMINI_API_KEY` is not present in `.env`, the backend operates in **fallback mode** (`generated_by: "fallback"`).
   - In fallback mode, POs are created using deterministic best-reliability supplier logic.
   - To activate live multi-turn LLM reasoning, add `GEMINI_API_KEY=your_key` to `.env`.
2. **Persistence**:
   - Storage is currently in-memory (`store.py`). Data resets when backend restarts (sufficient for hackathon demo).
   - A `database.py` scaffold exists for future SQLite/PostgreSQL migration if required.

---

## 5. Quick Verification & Execution Commands

```bash
# 1. Run integration test suite
python test_integration.py

# 2. Run quick smoke test
python smoke_test.py

# 3. Check health status
curl http://localhost:8000/health

# 4. Trigger the agent loop
curl -X POST http://localhost:8000/agent/run -H "Content-Type: application/json" -d "{\"dry_run\": false}"
```
