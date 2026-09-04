require('dotenv').config();
const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER; // e.g. whatsapp:+14155238886

// Initialize Twilio client
let client;
if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
}

app.post('/send-whatsapp', async (req, res) => {
  if (!client) {
    return res.status(500).json({ 
      error: 'Twilio credentials are not configured properly. Check your .env file.' 
    });
  }

  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ 
      error: 'Missing required fields: "to" and "message" must be provided.' 
    });
  }

  // Ensure 'whatsapp:' prefix for 'to' and 'from' numbers
  const toWhatsAppNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const fromWhatsAppNumber = twilioWhatsAppNumber.startsWith('whatsapp:') 
    ? twilioWhatsAppNumber 
    : `whatsapp:${twilioWhatsAppNumber}`;

  try {
    const response = await client.messages.create({
      body: message,
      from: fromWhatsAppNumber,
      to: toWhatsAppNumber
    });

    return res.status(200).json({
      success: true,
      messageSid: response.sid,
      status: response.status
    });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    
    // Provide a more descriptive error if it's a Sandbox join issue (Error 63015)
    if (error.code === 63015) {
      return res.status(400).json({
        error: 'Recipient has not joined the Twilio WhatsApp Sandbox. They must send the sandbox join code from their WhatsApp first.',
        twilioCode: error.code,
        details: error.message
      });
    }

    return res.status(500).json({
      error: 'Failed to send WhatsApp message.',
      twilioCode: error.code,
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp sender service is running on http://localhost:${PORT}`);
  console.log('Ensure you have joined the Twilio WhatsApp Sandbox for testing.');
});
