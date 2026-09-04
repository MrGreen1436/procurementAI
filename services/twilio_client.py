"""
services/twilio_client.py — Twilio outbound calling client.

Trial account rules (important!):
  - Can ONLY call phone numbers that are verified in the Twilio Console.
  - Must use inline TwiML (the `twiml` param), NOT a webhook URL param.
  - Verify the target number at:
    https://console.twilio.com/us1/develop/phone-numbers/manage/verified

All env vars are read lazily (inside functions) so load_dotenv() has
already run before these functions are called from main.py.

Required .env variables:
  TWILIO_ACCOUNT_SID         — Twilio Account SID
  TWILIO_AUTH_TOKEN          — Twilio Auth Token
  TWILIO_PHONE_NUMBER        — Your Twilio outbound number (E.164)
  DEMO_SUPPLIER_PHONE_NUMBER — Friend's verified phone number (E.164)
"""

import os
from datetime import datetime
from typing import Optional


def _get_config() -> dict:
    """Read all Twilio config from environment at call time (lazy)."""
    return {
        "account_sid": os.environ.get("TWILIO_ACCOUNT_SID", ""),
        "auth_token":  os.environ.get("TWILIO_AUTH_TOKEN", ""),
        "from_number": os.environ.get("TWILIO_PHONE_NUMBER", ""),
        "to_number":   os.environ.get("DEMO_SUPPLIER_PHONE_NUMBER", ""),
    }


def is_twilio_available() -> bool:
    """Return True only if all required env vars are set and twilio is installed."""
    cfg = _get_config()
    if not all([cfg["account_sid"], cfg["auth_token"], cfg["from_number"], cfg["to_number"]]):
        return False
    try:
        from twilio.rest import Client  # noqa: F401
        return True
    except ImportError:
        return False


def place_twilio_call(sku_id: str, supplier_name: str, reason: str) -> dict:
    """
    Place a REAL outbound Twilio call to DEMO_SUPPLIER_PHONE_NUMBER.

    Uses inline TwiML (compatible with trial accounts).
    The target number MUST be verified in the Twilio Console first.

    Returns dict with call_sid, status, to, timestamp on success.
    Returns dict with 'error' key on any failure — never fakes a result.
    """
    cfg = _get_config()

    missing = [k for k, v in cfg.items() if not v]
    if missing:
        msg = f"Missing Twilio env vars: {missing}"
        print(f"[Twilio] {msg}")
        return {"error": msg}

    try:
        from twilio.rest import Client
    except ImportError:
        return {"error": "twilio package not installed. Run: pip install twilio"}

    # Build URL for webhook (preferred, works on Twilio trial accounts via Cloudflare tunnel)
    public_url = os.environ.get("PUBLIC_URL", "").strip()

    try:
        client = Client(cfg["account_sid"], cfg["auth_token"])
        
        if public_url:
            import urllib.parse
            params = urllib.parse.urlencode({
                "sku_id": sku_id,
                "supplier": supplier_name,
                "reason": reason,
                "itemName": sku_id,
                "supplierName": supplier_name,
            })
            voice_url = f"{public_url.rstrip('/')}/voice-handler?{params}"
            print(f"[Twilio] Calling via webhook: {voice_url}")
            call = client.calls.create(
                url=voice_url,
                to=cfg["to_number"],
                from_=cfg["from_number"],
            )
        else:
            # Fallback to inline TwiML if no PUBLIC_URL provided
            message = (
                f"Hello! This is an automated procurement alert from the Retail A I system. "
                f"We are contacting you regarding supplier {supplier_name} "
                f"for stock item {sku_id}. "
                f"Alert reason: {reason}. "
                f"Please check the RetailAI dashboard for full details. "
                f"Thank you. Goodbye."
            )
            twiml = (
                '<?xml version="1.0" encoding="UTF-8"?>'
                "<Response>"
                f'<Say voice="Polly.Joanna" language="en-US">{message}</Say>'
                '<Pause length="1"/>'
                f'<Say voice="Polly.Joanna" language="en-US">{message}</Say>'
                "</Response>"
            )
            call = client.calls.create(
                twiml=twiml,
                to=cfg["to_number"],
                from_=cfg["from_number"],
            )

        print(
            f"[Twilio] [OK] Call initiated to {cfg['to_number']} "
            f"| SID: {call.sid} | Status: {call.status}"
        )
        return {
            "call_sid":  call.sid,
            "status":    call.status,
            "to":        cfg["to_number"],
            "from_":     cfg["from_number"],
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as exc:
        # Strip non-ASCII chars so Windows cp1252 console doesn't crash
        raw_msg = str(exc).encode("ascii", errors="replace").decode("ascii")
        error_msg = raw_msg

        # Give actionable guidance for the most common trial account errors
        if "21608" in raw_msg or "unverified" in raw_msg.lower():
            error_msg = (
                f"Twilio trial account: {cfg['to_number']} is not a verified number. "
                "Go to https://console.twilio.com -> Phone Numbers -> Verified Caller IDs "
                "and add this number, then try again."
            )
        elif "trial" in raw_msg.lower() or "limited parameter" in raw_msg.lower() or "disallowed" in raw_msg.lower():
            error_msg = (
                f"Twilio trial restriction: Ensure Cloudflare tunnel is running and PUBLIC_URL is set in .env."
            )

        print(f"[Twilio] [ERROR] Call failed: {error_msg}")
        return {"error": error_msg}


import re

WORD_TO_NUM = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
    'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50,
    'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
    'hundred': 100, 'thousand': 1000
}


def parse_spoken_number(text: str) -> Optional[float]:
    """Extract a numeric price from speech-to-text transcript."""
    if not text:
        return None
    cleaned = text.replace(',', '')
    match = re.search(r'(?:[\$₹£€]|rs\.?|inr|usd)?\s*(\d+(?:\.\d{1,2})?)', cleaned, re.IGNORECASE)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass

    tokens = re.findall(r'\b[a-z]+\b', text.lower())
    total = 0
    current = 0
    found_num = False
    for token in tokens:
        if token in WORD_TO_NUM:
            found_num = True
            val = WORD_TO_NUM[token]
            if val in (100, 1000):
                current = (current if current != 0 else 1) * val
                total += current
                current = 0
            else:
                current += val
        elif token in ('and', 'dollars', 'dollar', 'rupees', 'rupee', 'bucks', 'cents', 'per', 'unit', 'piece', 'each'):
            continue
        else:
            if current > 0:
                total += current
                current = 0

    total += current
    return float(total) if found_num and total > 0 else None


import xml.sax.saxutils

def escape_xml(text: str) -> str:
    """Safely escape text for XML attribute values and elements."""
    return xml.sax.saxutils.escape(str(text or ""), entities={'"': "&quot;", "'": "&apos;"})


def build_voice_twiml(sku_id: str, supplier: str, reason: str, action_url: str = "") -> str:
    """Build a TwiML XML string with speech gather for price negotiation."""
    supplier_clean = supplier.replace("%20", " ")
    reason_clean   = reason.replace("%20", " ")
    sku_clean      = sku_id.replace("%20", " ")

    prompt = (
        f"Hello! This is Procurement A I calling. "
        f"We are reviewing the stock risk for product {sku_clean} with {supplier_clean}. "
        f"We would like to confirm your latest unit price for this product. "
        f"Could you please state your offered price per unit?"
    )

    escaped_prompt = escape_xml(prompt)

    if action_url:
        escaped_action = escape_xml(action_url)
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<Response>\n"
            f'  <Gather input="speech" action="{escaped_action}" method="POST" speechTimeout="auto" timeout="6" language="en-US" speechModel="phone_call">\n'
            f'    <Say voice="Polly.Joanna" language="en-US">{escaped_prompt}</Say>\n'
            "  </Gather>\n"
            '  <Say voice="Polly.Joanna" language="en-US">We did not receive any price response. Thank you for your time. Goodbye.</Say>\n'
            "  <Hangup/>\n"
            "</Response>"
        )

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<Response>\n"
        f'  <Say voice="Polly.Joanna" language="en-US">{escaped_prompt}</Say>\n'
        '  <Pause length="1"/>\n'
        '  <Say voice="Polly.Joanna" language="en-US">Thank you. Goodbye.</Say>\n'
        "  <Hangup/>\n"
        "</Response>"
    )


def build_voice_response_twiml(speech_result: str, price: Optional[float]) -> str:
    """Build a TwiML response acknowledging the spoken price and hanging up."""
    if price is not None:
        message = (
            f"Thank you! We have recorded your quoted price of {price:g} dollars per unit "
            f"in our procurement system. Have a great day. Goodbye!"
        )
    elif speech_result:
        message = (
            f"Thank you! We have recorded your response. Have a great day. Goodbye!"
        )
    else:
        message = "Thank you. Goodbye!"

    escaped_message = escape_xml(message)

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<Response>\n"
        f'  <Say voice="Polly.Joanna" language="en-US">{escaped_message}</Say>\n'
        "  <Hangup/>\n"
        "</Response>"
    )

