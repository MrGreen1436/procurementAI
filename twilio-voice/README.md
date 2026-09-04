# Twilio Voice Quote Service

Automated outbound phone calls to suppliers using **Twilio Voice API**, with
built-in speech recognition and SQLite persistence.

Part of the **Procurement AI** system. Runs as an independent Node.js microservice
on port **3001** (Next.js stays on 3000, FastAPI stays on 8000).

---

## How it works

```
Your server           Twilio                    Supplier's phone
─────────────    ─────────────────────────   ──────────────────
POST /make-call ──▶ calls.create() ────────▶  📞 rings
                       │
                       ▼ (call connects)
POST /voice-handler ◀──────────────────────   answered
       │  (returns TwiML with <Gather speech>)
       │
       ▼ (supplier speaks)
POST /process-response ◀── SpeechResult ────  "fifty five dollars"
       │  (extracts price, saves to SQLite)
       │  (returns TwiML <Say> confirmation)
       ▼
 GET /quotes → returns all saved rows
```

---

## Prerequisites

- **Node.js 18+**
- A **Twilio account** with:
  - Account SID + Auth Token (from [console.twilio.com](https://console.twilio.com))
  - A purchased phone number with Voice capabilities
- **cloudflared** — Cloudflare's tunnel CLI (installed below via winget, no Cloudflare account required for quick tunnels)

---

## Installation

```bash
# Navigate to this directory
cd twilio-voice

# Install all dependencies
npm install
```

---

## Environment variables

```bash
# Copy the example file
cp .env.example .env
```

Then open `.env` and fill in:

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID (`ACxxx...`) |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Your Twilio outbound number in E.164 format (`+15550000000`) |
| `PUBLIC_URL` | The public HTTPS URL your tunnel tool gives you (see below) |
| `PORT` | Server port (default: `3001`) |

---

## Running with cloudflared (Cloudflare Tunnel)

cloudflared creates a no-account, no-signup HTTPS tunnel directly to your localhost.
No interstitial pages — Twilio webhooks reach your server without any bypass tricks.

### Step 1 — Install cloudflared (one-time)

```powershell
# Windows — via winget (recommended)
winget install --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements

# Verify installation
cloudflared --version
```

### Step 2 — Start the tunnel

In a **separate terminal**:

```bash
cloudflared tunnel --url http://localhost:3001
```

cloudflared will print several lines and then show:

```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://some-random-words.trycloudflare.com                                               |
+--------------------------------------------------------------------------------------------+
```

Copy the `https://some-random-words.trycloudflare.com` URL.

> **Important:** The URL changes every time you restart cloudflared.
> Each restart requires you to update `PUBLIC_URL` in `.env` and restart the Node server.

### Step 3 — Update .env with the new URL

Open `twilio-voice/.env` and set:

```env
PUBLIC_URL=https://some-random-words.trycloudflare.com
```

### Step 4 — Start (or restart) the Node server

```bash
# In the twilio-voice/ directory:
npm start
```

The startup banner will confirm the URL:
```
│  Public tunnel URL: https://some-random-words.trycloudflare.com
```

### Step 5 — (Optional) Configure Twilio webhook for inbound calls

If you want Twilio to also route *inbound* calls through this server:
- Go to **Phone Numbers → Active Numbers → your number** in Twilio Console
- Set **A Call Comes In** (Webhook) → `https://some-random-words.trycloudflare.com/voice-handler`

For *outbound* calls triggered by `POST /make-call`, the webhook URL is set
dynamically from `PUBLIC_URL` — no Twilio Console config needed.

---

## Endpoints

### `POST /make-call`

Places an outbound call to a supplier.

```bash
curl -X POST http://localhost:3001/make-call \
  -H "Content-Type: application/json" \
  -d '{
    "supplierPhoneNumber": "+15551234567",
    "supplierName": "Acme Steel Co",
    "itemName": "Cold-rolled steel sheet"
  }'
```

**Response:**
```json
{
  "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "queued"
}
```

---

### `POST /voice-handler` *(Twilio webhook — do not call directly)*

Returns TwiML. Twilio calls this automatically when the outbound call connects.
Uses `<Gather input="speech">` to capture the supplier's spoken price.

---

### `POST /process-response` *(Twilio webhook — do not call directly)*

Twilio calls this with `SpeechResult` after the gather completes.
Extracts a price, saves to SQLite, and returns a TwiML confirmation.

---

### `GET /quotes`

Returns all captured quotes as JSON, newest first.

```bash
curl http://localhost:3001/quotes
```

**Response:**
```json
[
  {
    "id": 1,
    "supplier_name": "Acme Steel Co",
    "phone_number": "+15551234567",
    "item_name": "Cold-rolled steel sheet",
    "raw_transcript": "fifty five dollars per unit",
    "extracted_price": 55,
    "call_sid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "created_at": "2026-09-04T02:30:00.000Z"
  }
]
```

---

### `GET /health`

Quick health check.

```bash
curl http://localhost:3001/health
```

---

## Database

SQLite file created automatically at `twilio-voice/quotes.db`.

**Table: `supplier_quotes`**

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Auto-increment PK |
| `supplier_name` | TEXT | From request body |
| `phone_number` | TEXT | Supplier's number (Twilio `To` field) |
| `item_name` | TEXT | From request body |
| `raw_transcript` | TEXT | Verbatim Twilio SpeechResult |
| `extracted_price` | REAL | Parsed price, or NULL if extraction failed |
| `call_sid` | TEXT | Twilio Call SID |
| `created_at` | TEXT | ISO 8601 UTC timestamp |

You can inspect it directly:

```bash
# Windows — use sqlite3 if installed, or a GUI like DB Browser for SQLite
sqlite3 quotes.db "SELECT * FROM supplier_quotes;"
```

---

## Running the tests

```bash
node utils.test.js
```

Tests the price extraction utility against numeric and word-based inputs:
- `$42.50` → `42.5`
- `fifty five dollars` → `55`
- `one hundred and twenty five` → `125`

---

## Price extraction details

The `extractPrice()` function in `utils.js` uses two strategies:

1. **Regex** — looks for patterns like `$42`, `$1,250.00`, `99.99`
2. **Word-to-number** — maps English words like `"fifty five dollars"` → `55`

If no price is found, `extracted_price` is saved as `NULL` in the DB but
`raw_transcript` is always preserved, so no data is ever lost.

---

## Integration with the main Procurement AI system

The Python backend (`supplier_outreach.py`) currently has a placeholder comment:
> *"Replace `_do_simulated_call()` body with a Twilio / Vapi / Bland.ai REST call."*

To wire this service into the Python agent, call `POST /make-call` from Python:

```python
import requests

requests.post("http://localhost:3001/make-call", json={
    "supplierPhoneNumber": supplier["phone"],
    "supplierName":        supplier["name"],
    "itemName":            sku_id,
})
```

Then poll `GET /quotes` (filtering by `call_sid`) to retrieve the captured price.
