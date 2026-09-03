# ProcurementAI — Deployment & Production Guide

This guide covers setting up, deploying, and managing the **ProcurementAI** platform across local development, Docker containers, and cloud environments.

---

## 1. System Architecture

- **Backend**: FastAPI (Python 3.12/3.13) exposing RESTful APIs, ML forecast inferences (XGBoost), What-If Simulator engine, and bi-directional WebSockets (`/ws`) / Server-Sent Events (`/events`).
- **Database Layer**: SQLAlchemy with automatic table migrations on startup.
  - **Development Default**: SQLite (`procurement.db`) with zero setup.
  - **Production / Container**: PostgreSQL 16 via `DATABASE_URL=postgresql://...`.
- **Frontend**: Next.js 15 (App Router, Tailwind CSS, Lucide Icons, Recharts, Sonner toasts).
- **Real-Time Engine**: `ConnectionManager` broadcasting live WebSocket events for email parsing, risk alerts, PO updates, and scenario runs.

---

## 2. Quickstart (Local Development)

### Prerequisites
- Python 3.12+
- Node.js 20+

### Step 1: Backend Setup
```bash
# Install dependencies
pip install -r requirements.txt
pip install python-dotenv sqlalchemy psycopg2-binary websockets python-multipart google-genai

# (Optional) Copy .env.example to .env and set GEMINI_API_KEY
cp .env.example .env

# Run FastAPI backend
uvicorn main:app --reload --port 8000
```
- API Documentation: [http://localhost:8000/docs](http://localhost:8000/docs)
- Health Check: [http://localhost:8000/health](http://localhost:8000/health)

### Step 2: Frontend Setup
```bash
# Install npm dependencies
npm install

# Start Next.js development server
npm run dev
```
- Web Application: [http://localhost:3000](http://localhost:3000)

---

## 3. Docker Compose Deployment (Recommended)

Run the complete full-stack environment (FastAPI + Next.js + PostgreSQL) with a single command:

```bash
# Build and launch all services
docker compose up --build -d

# Check service status and health
docker compose ps

# View unified logs
docker compose logs -f
```

### Services launched:
| Service | Port | Description |
| :--- | :--- | :--- |
| **frontend** | `3000` | Next.js Dashboard UI |
| **backend** | `8000` | FastAPI REST & WebSocket Server |
| **postgres** | `5432` | PostgreSQL 16 with persistent volume `postgres_data` |

To stop the services:
```bash
docker compose down
```

---

## 4. Cloud Deployments

### Option A: Render (Web Service + Managed Postgres)
1. **Create PostgreSQL Database** on Render dashboard. Copy the Internal Database URL.
2. **Deploy Backend**:
   - Environment: `Python 3`
   - Build Command: `pip install -r requirements.txt && pip install python-dotenv sqlalchemy psycopg2-binary websockets python-multipart google-genai`
   - Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Environment Variables:
     - `DATABASE_URL`: Your Render Postgres URL
     - `GEMINI_API_KEY`: (optional)
3. **Deploy Frontend**:
   - Environment: `Node`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Environment Variables:
     - `NEXT_PUBLIC_API_URL`: Your deployed backend URL
     - `NEXT_PUBLIC_WS_URL`: `wss://your-backend.onrender.com/ws`

### Option B: Fly.io (Docker)
1. Deploy Backend:
   ```bash
   fly launch --dockerfile Dockerfile.backend --name procurement-backend
   ```
2. Deploy Frontend:
   ```bash
   fly launch --dockerfile Dockerfile.frontend --name procurement-frontend
   ```

### Option C: Railway
- One-click deploy from GitHub repository using the included `docker-compose.yml` or Dockerfiles.

---

## 5. Persistence & Database Verification

The database automatically initializes all tables on startup:
- `purchase_orders`: All generated, approved, and rejected purchase orders.
- `risk_alerts`: Active stockout alerts with dates and risk severity.
- `supplier_email_logs`: Raw and parsed supplier delay notices.
- `scenario_runs`: What-if simulation runs with cost impacts and SKU lists.

To verify database tables locally:
```bash
python -c "import database; database.init_db(); print('Tables:', database.Base.metadata.tables.keys())"
```

---

## 6. Real-Time Verification

Test the WebSocket connection using Python or the browser console:
```bash
python test_simulator_db_realtime.py
```
Or open [http://localhost:3000](http://localhost:3000) and verify the **🟢 Live Sync Connected** badge in the header.
