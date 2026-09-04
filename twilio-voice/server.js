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
// POST /voice-handler
// Twilio calls this URL when the outbound call connects.
// Returns TwiML that greets the supplier and gathers their spoken price.
//
// Query params (set by /make-call):
//   ?itemName=Cold-rolled+steel+sheet&supplierName=Acme+Steel+Co
//
// Optionally:
//   ?retry=1  →  First retry (ask again, no further retries)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/voice-handler', (req, res) => {
  const itemName     = req.query.itemName     || 'the requested item';
  const supplierName = req.query.supplierName || 'supplier';
  const retry        = parseInt(req.query.retry || '0', 10);

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
      `Hello, this is an automated call from the procurement team regarding pricing for ${itemName}. ` +
      `Please state your best price after the beep. ` +
      `You can say, for example, fifty dollars, or one hundred twenty five.`
    );

    // If Gather times out without speech, Twilio falls through to the next verb.
    // We redirect to /voice-handler with retry=1 for one more attempt.
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
      `We did not hear your response. Please state your best price for ${itemName} now.`
    );

    // Second timeout → hang up gracefully
    twiml.say(
      { voice: 'Polly.Joanna' },
      `We were unable to capture your response. We will follow up via email. Thank you. Goodbye.`
    );
    twiml.hangup();
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /process-response
// Twilio posts here after Gather captures speech (or times out with a result).
//
// Twilio's request body includes (among many fields):
//   SpeechResult  — raw transcribed text, e.g. "fifty five dollars"
//   CallSid       — the unique call identifier
//   Confidence    — transcription confidence 0.0 – 1.0
//
// Query params (passed through from /voice-handler):
//   ?itemName=...&supplierName=...
// ─────────────────────────────────────────────────────────────────────────────
app.post('/process-response', (req, res) => {
  // Read Twilio's posted fields
  const rawTranscript = (req.body.SpeechResult || '').trim();
  const callSid       = req.body.CallSid || 'unknown';
  const toNumber      = req.body.To   || '';   // Supplier's number (the "To" leg)
  const confidence    = req.body.Confidence || null;

  // Query params set by /voice-handler
  const itemName     = req.query.itemName     || 'unknown item';
  const supplierName = req.query.supplierName || 'unknown supplier';

  console.log(`[process-response] SID=${callSid} | supplier="${supplierName}" | transcript="${rawTranscript}"`);

  // ── Price extraction ───────────────────────────────────────────────────────
  // extractPrice() returns a number or null if no price found
  const extractedPrice = rawTranscript ? extractPrice(rawTranscript) : null;

  if (extractedPrice !== null) {
    console.log(`[process-response] Extracted price: $${extractedPrice}`);
  } else {
    console.warn(`[process-response] Could not extract price from: "${rawTranscript}"`);
  }

  // ── Save to SQLite ─────────────────────────────────────────────────────────
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
    // Never let a DB error crash the TwiML response — Twilio needs our reply
    console.error('[process-response] DB save error:', dbErr.message);
  }

  // ── Respond with TwiML confirmation ───────────────────────────────────────
  const twiml = new twilio.twiml.VoiceResponse();

  if (extractedPrice !== null) {
    twiml.say(
      { voice: 'Polly.Joanna' },
      `Thank you. We have recorded your price of ${extractedPrice} dollars for ${itemName}. ` +
      `Our team will be in touch. Goodbye.`
    );
  } else if (rawTranscript) {
    // We heard something but couldn't parse a price — confirm we recorded it
    twiml.say(
      { voice: 'Polly.Joanna' },
      `Thank you for your response. We have recorded your quote and our team will follow up. Goodbye.`
    );
  } else {
    // No speech at all
    twiml.say(
      { voice: 'Polly.Joanna' },
      `We did not receive a response. Our team will follow up with you directly. Goodbye.`
    );
  }

  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

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
