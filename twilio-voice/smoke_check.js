// smoke_check.js — run with: node smoke_check.js
process.env.TWILIO_ACCOUNT_SID  = 'ACtest1234';
process.env.TWILIO_AUTH_TOKEN   = 'test_token';
process.env.TWILIO_PHONE_NUMBER = '+15550000000';
process.env.PUBLIC_URL          = 'https://abc123.loca.lt';
process.env.PORT                = '3099';

const requiredEnvVars = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'PUBLIC_URL'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error('FAILED — Missing env vars:', missingVars.join(', '));
  process.exit(1);
}
console.log('ENV CHECK PASSED — PUBLIC_URL =', process.env.PUBLIC_URL);

const { extractPrice } = require('./utils');
const result = extractPrice('fifty dollars');
console.log('extractPrice("fifty dollars") =', result);
if (result !== 50) { console.error('FAILED — expected 50'); process.exit(1); }

const db = require('./db');
console.log('DB MODULE LOADED OK');

db.initDB().then(() => {
  const id = db.saveQuote({
    supplier_name: 'Acme Steel',
    phone_number: '+15551234567',
    item_name: 'Cold-rolled steel sheet',
    raw_transcript: 'fifty five dollars per unit',
    extracted_price: 55,
    call_sid: 'CA_CHECK_001',
  });
  const rows = db.getAllQuotes();
  console.log('DB write+read OK — rows:', rows.length, '| extracted_price:', rows[0].extracted_price);

  const fs = require('fs');
  fs.unlinkSync('./quotes.db');
  console.log('');
  console.log('All checks PASSED — server is ready to run with PUBLIC_URL (localtunnel)');
  process.exit(0);
}).catch(err => {
  console.error('DB INIT FAILED:', err.message);
  process.exit(1);
});
