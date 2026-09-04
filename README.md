# ProcureAI — Autonomous Supply Chain Intelligence & Risk Control Room

ProcureAI is an enterprise-grade autonomous procurement and supply chain intelligence platform. It integrates multi-model demand forecasting (XGBoost, ETS, LSTM), live supplier risk assessment, dynamic inventory simulation, automated PO generation, and comprehensive audit log governance into a mission-critical control room dashboard.

---

## Key Features

- **Autonomous PO Generation & Queue**: Automatically triggers purchase orders based on AI forecast discrepancies, safety stock thresholds, and lead-time constraints.
- **Multi-Model Demand Forecasting**:
  - XGBoost regressor for non-linear feature interaction
  - Exponential Smoothing (ETS) for trend/seasonality decomposition
  - LSTM recurrent networks for sequential pattern recognition
  - Dynamic dataset upload support (`.csv`, `.xlsx`) with accuracy verification tooling
- **Supplier Risk Intelligence**:
  - Live supplier risk scores with real-time tier classification (`CRITICAL`, `ELEVATED`, `STABLE`, `LOW`)
  - Multi-metric breakdown (on-time delivery, defect rate, lead time deviation)
  - Direct actions for supplier mitigation outreach and alternate supplier routing
- **Audit Governance & Trail Timeline**:
  - Full transparency timeline tracking automated actions, manual overrides, risk escalations, and system dispatches
  - Dedicated Audit Log governance explorer with category filtering, severity filtering, and JSON/CSV export
- **Interactive Disruption Simulator**:
  - Real-time supply chain stress-testing (demand spikes, supplier delays, lead time shocks)
  - What-if scenario analysis with cascading impact calculation
- **Solar Storm Dimensional UI**:
  - High-contrast mission-critical dark theme (`#080c14` backdrop)
  - 3D interactive hero KPI tilt cards with live reactive glow effects
  - Micro-animations, live pulse indicators, and responsive data visualizations

---

## Tech Stack

### Frontend
- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Styling**: Tailwind CSS v4 + Solar Storm custom dimensional design tokens
- **Data Visualization**: Recharts + Tremor
- **Icons & UI**: Lucide React, Sonner (Toasts)

### Backend & Machine Learning
- **API Framework**: FastAPI + Uvicorn
- **ML / Forecasting**: XGBoost, Scikit-learn, Statsmodels (ETS), PyTorch / TensorFlow (LSTM)
- **Data Engineering**: Pandas, NumPy, OpenPyXL
- **Database**: SQLite (SQLAlchemy ORM)
- **Agent Integrations**: Google Gemini API, automated communication tools

---

## Project Structure

```
procurementAI/
├── app/
│   ├── audit-log/       # Dedicated Audit Governance & Event History page
│   ├── chat/            # Procurement AI Agent interactive assistant
│   ├── po-queue/        # Automated Purchase Order approvals & queue
│   ├── simulator/       # Supply Chain Disruption simulator
│   ├── globals.css      # Solar Storm design tokens & dimensional depth CSS
│   ├── layout.tsx       # Root layout with sidebar navigation
│   └── page.tsx         # Mission-critical Executive Dashboard
├── components/
│   ├── AuditTrailPanel.tsx    # Live governance timeline
│   ├── HeroKpiCard.tsx        # 3D interactive tilt KPI cards
│   ├── SupplierRiskPanel.tsx  # Tiered supplier risk intelligence grid
│   ├── sidebar.tsx            # Navigation sidebar
│   └── ui/                    # Base UI component library
├── lib/
│   ├── api.ts           # REST API client with fallback resilience
│   └── mockData.ts      # Structured fallback datasets
├── services/            # Backend service layers (alerts, outreach, vapi)
├── main.py              # FastAPI application & REST endpoints
├── database.py          # SQLite database schema & repository methods
├── ets.py               # Exponential Smoothing forecasting engine
├── xgboost_model.py     # XGBoost forecasting model
└── verify_accuracy.py   # Multi-model accuracy evaluation suite
```

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- Python 3.10+
- npm / yarn

### Backend Setup
1. Navigate to the repository root:
   ```bash
   pip install -r requirements.txt
   ```
2. Start the FastAPI backend:
   ```bash
   python -m uvicorn main:app --reload --port 8000
   ```

### Frontend Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the development server:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your browser.
