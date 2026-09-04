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
// SYNC HELPER: Forward quote to FastAPI backend (Port 8000)
// ─────────────────────────────────────────────────────────────────────────────
function forwardQuoteToBackend({ callSid, skuId, supplierName, price, transcription, status = 'completed', availability = 'in_stock' }) {
  try {
    const http = require('http');
    const syncData = JSON.stringify({
      call_sid:        callSid,
      sku_id:          skuId,
      supplier_name:   supplierName,
      price:           price,
      transcription:   transcription,
      status:          status,
      availability:    availability
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
      timeout: 3000
    }, (syncRes) => {
      // response consumed
    });
    syncReq.on('error', (e) => {
      console.warn('[syncQuote] Could not forward to FastAPI:', e.message);
    });
    syncReq.write(syncData);
    syncReq.end();
  } catch (err) {
    console.warn('[syncQuote] Request error:', err.message);
  }
}

// Helper to make alphanumeric SKUs like "P0001" sound natural ("item P 0 0 0 1")
function formatSpokenItem(item) {
  if (!item) return 'the requested item';
  return String(item).replace(/([A-Za-z])(\d+)/g, '$1 $2');
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE HANDLER (TwiML Webhook)
// Supports /voice-handler and /voice (GET and POST)
// Greets the supplier as Procurement AI and begins the conversational negotiation.
// ─────────────────────────────────────────────────────────────────────────────
function handleVoice(req, res) {
  const itemName     = req.query.itemName || req.query.sku_id || req.query.sku || req.body.itemName || req.body.sku_id || 'the requested item';
  const supplierName = req.query.supplierName || req.query.supplier || req.body.supplierName || req.body.supplier || 'supplier';

  const spokenItem = formatSpokenItem(itemName);
  const twiml = new twilio.twiml.VoiceResponse();

  // Natural, clear greeting — played outside Gather with bargeIn disabled
  // so opening connection noises / initial "Hello?" do NOT truncate the introduction!
  twiml.say(
    { voice: 'Polly.Joanna', language: 'en-US' },
    `Hello! This is Procurement AI calling on behalf of the inventory management team. ` +
    `We are reaching out to ${supplierName} regarding the unit price for item ${spokenItem}, ` +
    `which is currently flagged for purchase order reordering.`
  );

  twiml.pause({ length: 1 });

  const processUrl = webhookUrl(
    `/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=price&attempt=1`
  );

  const priceHints = [
    'one two three four five six seven eight nine ten',
    'twenty thirty forty fifty sixty seventy eighty ninety hundred thousand',
    'dollars cents per unit price quote bucks',
    'in stock available yes out of stock no hello who is this repeat',
  ].join(' ');

  const gather = twiml.gather({
    input:         'speech',
    action:        processUrl,
    method:        'POST',
    timeout:       8,
    speechTimeout: 'auto',
    bargeIn:       false,
    language:      'en-US',
    speechModel:   'phone_call',
    hints:         priceHints,
  });

  gather.say(
    { voice: 'Polly.Joanna', language: 'en-US' },
    `Could you please tell me your current unit price for ${spokenItem}?`
  );

  // If no speech detected after timeout, redirect to handle silence
  const silenceUrl = webhookUrl(
    `/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=silence&attempt=1`
  );
  twiml.redirect({ method: 'POST' }, silenceUrl);

  res.type('text/xml');
  res.send(twiml.toString());
}

app.all('/voice-handler', handleVoice);
app.all('/voice', handleVoice);

// ─────────────────────────────────────────────────────────────────────────────
// PROCESS RESPONSE (TwiML Gather Action Webhook)
// Multi-turn conversational handler:
// 1. Understands greetings & identity inquiries ("Who is this?", "Hello?")
// 2. Understands repetition requests ("Can you repeat that?")
// 3. Captures spoken price & confirms it by asking about stock availability
// 4. Handles out-of-stock or unavailability responses
// 5. Never prematurely hangs up with a blind "Thank you goodbye"!
// ─────────────────────────────────────────────────────────────────────────────
function handleProcessResponse(req, res) {
  const rawTranscript = (req.body.SpeechResult || req.query.SpeechResult || '').trim();
  const callSid       = req.body.CallSid || req.query.CallSid || 'unknown';
  const toNumber      = req.body.To || req.query.To || '';
  const confidence    = parseFloat(req.body.Confidence || req.query.Confidence || '0');

  const itemName     = req.query.itemName || req.query.sku_id || req.query.sku || req.body.itemName || 'unknown item';
  const supplierName = req.query.supplierName || req.query.supplier || req.body.supplierName || 'supplier';
  const step         = req.query.step || req.body.step || 'price';
  const attempt      = parseInt(req.query.attempt || req.body.attempt || '1', 10);
  const existingPrice = req.query.price || req.body.price || null;

  const spokenItem = formatSpokenItem(itemName);
  console.log(`[process-response] SID=${callSid} | Step=${step} | Attempt=${attempt} | Transcript="${rawTranscript}" | Confidence=${confidence}`);

  const twiml = new twilio.twiml.VoiceResponse();
  const lower = rawTranscript.toLowerCase();

  const priceHints = 'one two three four five six seven eight nine ten twenty thirty forty fifty sixty seventy eighty ninety hundred thousand dollars per unit in stock available yes no';

  // ───────────────────────────────────────────────────────────────────────────
  // STEP: SILENCE (User didn't speak or timeout occurred)
  // ───────────────────────────────────────────────────────────────────────────
  if (step === 'silence') {
    if (attempt < 2) {
      twiml.say({ voice: 'Polly.Joanna', language: 'en-US' }, `Hello? I am still on the line.`);
      twiml.pause({ length: 1 });
      const gather = twiml.gather({
        input: 'speech',
        action: webhookUrl(`/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=price&attempt=${attempt + 1}`),
        method: 'POST',
        timeout: 8,
        speechTimeout: 'auto',
        bargeIn: false,
        language: 'en-US',
        speechModel: 'phone_call',
        hints: priceHints,
      });
      gather.say(
        { voice: 'Polly.Joanna', language: 'en-US' },
        `Could you please tell me your current unit price for ${spokenItem}?`
      );
      twiml.redirect({ method: 'POST' }, webhookUrl(`/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=silence&attempt=${attempt + 1}`));
    } else {
      twiml.say(
        { voice: 'Polly.Joanna', language: 'en-US' },
        `We did not hear a response. Our procurement team will follow up with ${supplierName} via email. Thank you, goodbye.`
      );
      twiml.hangup();
    }
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP: STOCK (Asking about stock availability after price was established)
  // ───────────────────────────────────────────────────────────────────────────
  if (step === 'stock') {
    const isYes = /\b(yes|yeah|yep|sure|in stock|available|we do|have stock|ready|got it)\b/i.test(lower);
    const isNo  = /\b(no|nope|out of stock|not available|backorder|lead time|don't have|dont have)\b/i.test(lower);

    let availability = 'in_stock';

    if (isNo) {
      availability = 'lead_time_required';
      twiml.say(
        { voice: 'Polly.Joanna', language: 'en-US' },
        `Understood. I have recorded your quoted price of ${existingPrice} dollars per unit and noted the stock availability constraint. ` +
        `Our procurement manager will review and follow up with an order. Thank you so much for your time, goodbye!`
      );
    } else {
      twiml.say(
        { voice: 'Polly.Joanna', language: 'en-US' },
        `Fantastic! I have updated our purchase order queue with your quoted price of ${existingPrice} dollars per unit ` +
        `and confirmed that item ${spokenItem} is in stock and ready to order. Thank you very much for your time, have a great day. Goodbye!`
      );
    }

    twiml.hangup();

    // Persist to local SQLite and FastAPI backend
    try {
      db.saveQuote({
        supplier_name:   supplierName,
        phone_number:    toNumber,
        item_name:       itemName,
        raw_transcript:  rawTranscript,
        extracted_price: parseFloat(existingPrice),
        call_sid:        callSid,
      });
    } catch (e) {
      console.error('[process-response] DB save error:', e.message);
    }

    forwardQuoteToBackend({
      callSid,
      skuId: itemName,
      supplierName,
      price: parseFloat(existingPrice),
      transcription: rawTranscript ? `Stock response: "${rawTranscript}"` : `Price: $${existingPrice}`,
      status: 'completed',
      availability
    });

    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP: DONE (Graceful confirmation when stock question timed out)
  // ───────────────────────────────────────────────────────────────────────────
  if (step === 'done') {
    twiml.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `Thank you. We have recorded your quoted price of ${existingPrice} dollars per unit in the purchase order queue. Goodbye!`
    );
    twiml.hangup();
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP: PRICE (Primary negotiation turn)
  // ───────────────────────────────────────────────────────────────────────────

  // Empty speech result -> redirect to silence handler
  if (!rawTranscript) {
    const silenceUrl = webhookUrl(
      `/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=silence&attempt=${attempt}`
    );
    twiml.redirect({ method: 'POST' }, silenceUrl);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // 1. Attempt price extraction from the transcript
  const extractedPrice = extractPrice(rawTranscript);

  if (extractedPrice !== null && extractedPrice > 0) {
    console.log(`[process-response] Successfully extracted price: $${extractedPrice}`);

    // Persist immediately so even if call disconnects now, quote is safely preserved
    try {
      db.saveQuote({
        supplier_name:   supplierName,
        phone_number:    toNumber,
        item_name:       itemName,
        raw_transcript:  rawTranscript,
        extracted_price: extractedPrice,
        call_sid:        callSid,
      });
    } catch (dbErr) {
      console.error('[process-response] DB save error:', dbErr.message);
    }

    forwardQuoteToBackend({
      callSid,
      skuId: itemName,
      supplierName,
      price: extractedPrice,
      transcription: rawTranscript,
      status: 'completed',
      availability: 'in_stock'
    });

    // Conversational follow-up: ask about stock availability
    const stockUrl = webhookUrl(
      `/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=stock&price=${extractedPrice}`
    );
    const doneUrl = webhookUrl(
      `/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=done&price=${extractedPrice}`
    );

    const gather = twiml.gather({
      input:         'speech',
      action:        stockUrl,
      method:        'POST',
      timeout:       7,
      speechTimeout: 'auto',
      bargeIn:       false,
      language:      'en-US',
      speechModel:   'phone_call',
      hints:         'yes in stock available out of stock no ready',
    });

    gather.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `Got it, ${extractedPrice} dollars per unit. Do you currently have units in stock and ready to ship?`
    );

    twiml.redirect({ method: 'POST' }, doneUrl);

    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // 2. No price found — check conversational intents
  const isWho = /\b(who is this|who are you|who's calling|who is calling|who called|who's this|what company|what is this|why are you calling|who is speaking)\b/i.test(lower);
  const isRepeat = /\b(repeat|again|pardon|sorry|what did you say|say that again|didn't hear|come again|tell me again)\b/i.test(lower);
  const isHello = /^(hello|hi|hey|yes|yeah|speaking)\b/i.test(lower);
  const isOutOfStock = /\b(out of stock|no stock|unavailable|don't have|dont have|not available|discontinued)\b/i.test(lower);

  // Supplier states they are out of stock
  if (isOutOfStock) {
    twiml.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `Understood. I will update our procurement records to show that ${spokenItem} is currently out of stock. Thank you for your time, goodbye!`
    );
    twiml.hangup();

    forwardQuoteToBackend({
      callSid,
      skuId: itemName,
      supplierName,
      price: null,
      transcription: rawTranscript,
      status: 'completed',
      availability: 'out_of_stock'
    });

    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Supplier asking who is calling
  if (isWho && attempt < 3) {
    const nextUrl = webhookUrl(
      `/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=price&attempt=${attempt + 1}`
    );
    twiml.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `This is Procurement AI's automated procurement agent. We manage inventory replenishment and are preparing a purchase order for item ${spokenItem}.`
    );
    twiml.pause({ length: 1 });

    const gather = twiml.gather({
      input:         'speech',
      action:        nextUrl,
      method:        'POST',
      timeout:       8,
      speechTimeout: 'auto',
      bargeIn:       false,
      language:      'en-US',
      speechModel:   'phone_call',
      hints:         priceHints,
    });
    gather.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `Could you please provide your current unit price in dollars?`
    );
    twiml.redirect({ method: 'POST' }, nextUrl);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Supplier asking to repeat
  if (isRepeat && attempt < 3) {
    const nextUrl = webhookUrl(
      `/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=price&attempt=${attempt + 1}`
    );
    const gather = twiml.gather({
      input:         'speech',
      action:        nextUrl,
      method:        'POST',
      timeout:       8,
      speechTimeout: 'auto',
      bargeIn:       false,
      language:      'en-US',
      speechModel:   'phone_call',
      hints:         priceHints,
    });
    gather.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `Certainly! We are looking for your unit price quote for item ${spokenItem}. What is your price per unit? For example, fifty dollars.`
    );
    twiml.redirect({ method: 'POST' }, nextUrl);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Supplier said greeting (e.g. "Hello?")
  if (isHello && attempt < 3) {
    const nextUrl = webhookUrl(
      `/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=price&attempt=${attempt + 1}`
    );
    const gather = twiml.gather({
      input:         'speech',
      action:        nextUrl,
      method:        'POST',
      timeout:       8,
      speechTimeout: 'auto',
      bargeIn:       false,
      language:      'en-US',
      speechModel:   'phone_call',
      hints:         priceHints,
    });
    gather.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `Hi there! Could you please tell me your current price per unit for item ${spokenItem}?`
    );
    twiml.redirect({ method: 'POST' }, nextUrl);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Other non-price speech — prompt for price again
  if (attempt < 3) {
    const nextUrl = webhookUrl(
      `/process-response?itemName=${encodeURIComponent(itemName)}&supplierName=${encodeURIComponent(supplierName)}&step=price&attempt=${attempt + 1}`
    );
    const gather = twiml.gather({
      input:         'speech',
      action:        nextUrl,
      method:        'POST',
      timeout:       8,
      speechTimeout: 'auto',
      bargeIn:       false,
      language:      'en-US',
      speechModel:   'phone_call',
      hints:         priceHints,
    });
    gather.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `I didn't quite catch the dollar amount. Could you please say your price per unit for ${spokenItem}? For example, say fifty dollars.`
    );
    twiml.redirect({ method: 'POST' }, nextUrl);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Max attempts reached without price
  twiml.say(
    { voice: 'Polly.Joanna', language: 'en-US' },
    `We were unable to record a price quote today. Our procurement team will follow up via email. Thank you for your time, goodbye.`
  );
  twiml.hangup();
  res.type('text/xml');
  return res.send(twiml.toString());
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
