/**
 * twilio-voice/server.js
 *
 * Automated outbound voice call service for procurement quotes.
 *
 * Flow:
 *   POST /make-call        → Places outbound call via Twilio REST API
 *   POST /voice-handler    → TwiML webhook: greets supplier, gathers speech
 *   POST /process-response → TwiML webhook: parses SpeechResult, saves to DB
 *   GET  /quotes           → Returns all saved quotes as JSON
 */

'use strict';

// ── Load env vars from .env FIRST, before anything else ──────────────────────
require('dotenv').config();

const express    = require('express');
const bodyParser = require('body-parser');
const twilio     = require('twilio');
const db         = require('./db');           // SQLite helper (auto-creates table)
const { extractPrice } = require('./utils'); // Price parser utility

// ── Twilio credentials from environment ──────────────────────────────────────
const ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER   = process.env.TWILIO_PHONE_NUMBER;
const PUBLIC_URL    = process.env.PUBLIC_URL; // e.g. https://abc123.loca.lt (localtunnel) or https://abc123.ngrok-free.app

// Validate required environment variables at startup
const requiredEnvVars = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'PUBLIC_URL'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error(`[FATAL] Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}

// Instantiate Twilio REST client
const twilioClient = twilio(ACCOUNT_SID, AUTH_TOKEN);

// ── Express app setup ─────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3001;

// Parse URL-encoded bodies (Twilio posts form-encoded data to webhooks)
app.use(bodyParser.urlencoded({ extended: false }));
// Parse JSON bodies (for our own POST /make-call endpoint)
app.use(bodyParser.json());

// ── Helper: build a full webhook URL pointing at our public tunnel ────────────
function webhookUrl(path) {
  // Strip trailing slash from PUBLIC_URL just in case
  return `${PUBLIC_URL.replace(/\/$/, '')}${path}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /make-call
// Trigger an outbound call to a supplier and ask for a price quote.
//
// Request body (JSON):
//   {
//     "supplierPhoneNumber": "+15551234567",
//     "supplierName":        "Acme Steel Co",
//     "itemName":            "Cold-rolled steel sheet"
//   }
//
// Response (JSON):
//   { "callSid": "CAxxxxxxx", "status": "queued" }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/make-call', async (req, res) => {
  const { supplierPhoneNumber, supplierName, itemName } = req.body;

  // Basic input validation
  if (!supplierPhoneNumber || !supplierName || !itemName) {
    return res.status(400).json({
      error: 'supplierPhoneNumber, supplierName, and itemName are all required.',
    });
  }

  try {
    // Build the voice-handler URL, passing itemName + supplierName as query params
    // so /voice-handler knows what to ask about
    const voiceHandlerUrl = webhookUrl(
      `/voice-handler?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}`
    );

    console.log(`[make-call] Calling ${supplierPhoneNumber} for item: "${itemName}"`);

    const call = await twilioClient.calls.create({
      to:   supplierPhoneNumber,
      from: FROM_NUMBER,
      url:  voiceHandlerUrl,      // Twilio fetches TwiML from here when call connects
    });

    console.log(`[make-call] Call initiated — SID: ${call.sid}`);
    return res.json({ callSid: call.sid, status: call.status });

  } catch (err) {
    console.error('[make-call] Twilio error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE HANDLER (TwiML Webhook)
// Supports /voice-handler and /voice (GET and POST)
// Greets the supplier as Procurement AI and gathers their spoken price.
// ─────────────────────────────────────────────────────────────────────────────
function handleVoice(req, res) {
  const itemName     = req.query.itemName || req.query.sku_id || req.query.sku || req.body.itemName || req.body.sku_id || 'the requested item';
  const supplierName = req.query.supplierName || req.query.supplier || req.body.supplierName || req.body.supplier || 'supplier';
  const retry        = parseInt(req.query.retry || req.body.retry || '0', 10);

  // Build the action URL where Twilio will POST the SpeechResult
  const processUrl = webhookUrl(
    `/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}`
  );

  // Build the retry URL (voice-handler again with retry flag)
  const retryUrl = webhookUrl(
    `/voice-handler?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&retry=1`
  );

  // Use Twilio's VoiceResponse helper to construct TwiML
  const twiml = new twilio.twiml.VoiceResponse();

  if (retry === 0) {
    // ── First attempt: ask for the price ─────────────────────────────────────
    const gather = twiml.gather({
      input:          'speech',       // Speech recognition (not DTMF)
      action:         processUrl,     // POST SpeechResult here
      speechTimeout:  'auto',         // Twilio auto-detects end of speech
      language:       'en-US',
      speechModel:    'phone_call',   // Optimised for phone audio quality
    });

    gather.say(
      { voice: 'Polly.Joanna' },
      `Hello, this is an automated call from Procurement AI wanting to discuss the unit price for item ${itemName}, which is currently at risk. ` +
      `Please state your best unit price after the tone.`
    );

    // If Gather times out without speech, retry once
    twiml.redirect({ method: 'POST' }, retryUrl);

  } else {
    // ── Second attempt: one more chance, then politely hang up ───────────────
    const gather = twiml.gather({
      input:         'speech',
      action:        processUrl,
      speechTimeout: 'auto',
      language:      'en-US',
      speechModel:   'phone_call',
    });

    gather.say(
      { voice: 'Polly.Joanna' },
      `We did not hear your response. Please state your quoted unit price for ${itemName} now.`
    );

    // Second timeout → hang up gracefully
    twiml.say(
      { voice: 'Polly.Joanna' },
      `We were unable to capture your response. We will follow up later. Thank you, goodbye.`
    );
    twiml.hangup();
  }

  res.type('text/xml');
  res.send(twiml.toString());
}

app.all('/voice-handler', handleVoice);
app.all('/voice', handleVoice);

// ─────────────────────────────────────────────────────────────────────────────
// PROCESS RESPONSE (TwiML Gather Action Webhook)
// Supports /process-response and /voice/respond (GET and POST)
// Twilio posts here after Gather captures speech.
// ─────────────────────────────────────────────────────────────────────────────
function handleProcessResponse(req, res) {
  // Read Twilio's posted fields from body or query
  const rawTranscript = (req.body.SpeechResult || req.query.SpeechResult || '').trim();
  const callSid       = req.body.CallSid || req.query.CallSid || 'unknown';
  const toNumber      = req.body.To || req.query.To || '';
  const confidence    = req.body.Confidence || req.query.Confidence || null;

  // Query params passed through from voice-handler
  const itemName     = req.query.itemName || req.query.sku_id || req.query.sku || req.body.itemName || 'unknown item';
  const supplierName = req.query.supplierName || req.query.supplier || req.body.supplierName || 'unknown supplier';

  console.log(`[process-response] SID=${callSid} | supplier="${supplierName}" | transcript="${rawTranscript}"`);

  // ── Price extraction ───────────────────────────────────────────────────────
  const extractedPrice = rawTranscript ? extractPrice(rawTranscript) : null;

  if (extractedPrice !== null) {
    console.log(`[process-response] Extracted price: $${extractedPrice}`);
  } else {
    console.warn(`[process-response] Could not extract price from: "${rawTranscript}"`);
  }

  // ── Save to local SQLite ───────────────────────────────────────────────────
  try {
    db.saveQuote({
      supplier_name:   supplierName,
      phone_number:    toNumber,
      item_name:       itemName,
      raw_transcript:  rawTranscript,
      extracted_price: extractedPrice,
      call_sid:        callSid,
    });
    console.log(`[process-response] Quote saved to DB for SID=${callSid}`);
  } catch (dbErr) {
    console.error('[process-response] DB save error:', dbErr.message);
  }

  // ── Forward to FastAPI backend (Port 8000) for real-time DB & WebSocket sync
  try {
    const http = require('http');
    const syncData = JSON.stringify({
      call_sid:        callSid,
      sku_id:          itemName,
      supplier_name:   supplierName,
      price:           extractedPrice,
      transcription:   rawTranscript,
      status:          'completed',
      availability:    'in_stock'
    });
    const syncReq = http.request({
      hostname: '127.0.0.1',
      port: 8000,
      path: '/internal/supplier-call-quote',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(syncData)
      },
      timeout: 2000
    }, (syncRes) => {
      // response consumed
    });
    syncReq.on('error', (e) => {
      // Backend may be momentarily busy or restarting
    });
    syncReq.write(syncData);
    syncReq.end();
  } catch (syncErr) {
    console.warn('[process-response] Could not forward quote to FastAPI:', syncErr.message);
  }

  // ── Respond with TwiML confirmation ───────────────────────────────────────
  const twiml = new twilio.twiml.VoiceResponse();

  if (extractedPrice !== null) {
    twiml.say(
      { voice: 'Polly.Joanna' },
      `Thank you. We have recorded your price of ${extractedPrice} dollars for ${itemName}. Thank you and goodbye.`
    );
  } else if (rawTranscript) {
    twiml.say(
      { voice: 'Polly.Joanna' },
      `Thank you. We have recorded your response. Thank you and goodbye.`
    );
  } else {
    twiml.say(
      { voice: 'Polly.Joanna' },
      `We did not receive a response. Thank you, goodbye.`
    );
  }

  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
}

app.all('/process-response', handleProcessResponse);
app.all('/voice/respond', handleProcessResponse);

// ─────────────────────────────────────────────────────────────────────────────
// GET /quotes
// Returns all saved supplier quotes as JSON.
// Useful for displaying in a frontend portal or debugging.
//
// Response: [ { id, supplier_name, phone_number, item_name, raw_transcript,
//               extracted_price, call_sid, created_at }, ... ]
// ─────────────────────────────────────────────────────────────────────────────
app.get('/quotes', (req, res) => {
  try {
    const quotes = db.getAllQuotes();
    return res.json(quotes);
  } catch (err) {
    console.error('[/quotes] DB read error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'twilio-voice-quotes', port: PORT });
});

// ── Start server ──────────────────────────────────────────────────────────────
// initDB() must complete before we accept any requests, as all webhook
// handlers rely on the database being ready.
async function start() {
  try {
    await db.initDB(); // initialise sql.js WASM engine + open/create quotes.db
  } catch (err) {
    console.error('[FATAL] Could not initialise database:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log('');
    console.log('┌──────────────────────────────────────────────────────┐');
    console.log('│  Twilio Voice Quote Service                          │');
    console.log(`│  Listening on http://localhost:${PORT}                  │`);
    console.log(`│  Public tunnel URL: ${PUBLIC_URL}`);
    console.log('│                                                      │');
    console.log('│  Endpoints:                                          │');
    console.log('│    POST /make-call        → Place outbound call      │');
    console.log('│    POST /voice-handler    → TwiML webhook (Twilio)   │');
    console.log('│    POST /process-response → Gather result (Twilio)   │');
    console.log('│    GET  /quotes           → Fetch all saved quotes   │');
    console.log('│    GET  /health           → Health check             │');
    console.log('└──────────────────────────────────────────────────────┘');
    console.log('');
  });
}

start();
