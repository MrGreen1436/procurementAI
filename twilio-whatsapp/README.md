# Twilio WhatsApp Sender (Standalone)

This is a minimal, self-contained Express application for sending WhatsApp messages using the Twilio API. It is completely isolated and runs on its own port (`3002`).

## Setup

1. Copy the example environment variables file and fill in your Twilio credentials:
   ```bash
   cp .env.example .env
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

## Environment Variables

- `TWILIO_ACCOUNT_SID`: Your Twilio Account SID.
- `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token.
- `TWILIO_WHATSAPP_NUMBER`: The Twilio WhatsApp Sandbox number (e.g., `whatsapp:+14155238886`).

## Twilio WhatsApp Sandbox Setup

Since you are using a Twilio trial account, you must use the **Twilio WhatsApp Sandbox**. 

1. **Find your Sandbox settings**:
   Log in to the Twilio Console, and navigate to **Messaging** > **Try it out** > **Send a WhatsApp message**.
   
2. **Join the Sandbox**:
   There will be a shared Twilio WhatsApp number (typically `+1 415 523 8886`) and a unique "join code" (e.g., `join <something-random>`).
   
   Before any number can receive a WhatsApp message from your application, the recipient must send this exact join code from their personal WhatsApp app to the Twilio Sandbox number.
   
3. **Important Limitations**:
   - This join step is required for *every* new recipient you want to test with.
   - The sandbox session expires after **3 days (72 hours)** of inactivity. If it expires, the recipient will need to re-send the join code to receive messages again.

## Testing

Once your server is running and you have successfully joined the sandbox, you can test sending a message.

### Using cURL
```bash
curl -X POST http://localhost:3002/send-whatsapp \
  -H "Content-Type: application/json" \
  -d '{"to": "+91XXXXXXXXXX", "message": "Hello from my self-contained Twilio WhatsApp app!"}'
```

### Using PowerShell
```powershell
Invoke-RestMethod -Uri "http://localhost:3002/send-whatsapp" `
  -Method Post `
  -Headers @{ "Content-Type" = "application/json" } `
  -Body '{"to": "+91XXXXXXXXXX", "message": "Hello from my self-contained Twilio WhatsApp app!"}'
```

Replace `+91XXXXXXXXXX` with the recipient's phone number in E.164 format.
