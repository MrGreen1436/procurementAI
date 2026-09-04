"""
services/vapi_client.py ΓÇö Vapi API client wrapper.

Provides two functions:
  - trigger_outbound_call(): initiates a real outbound call via Vapi REST API.
  - get_call_status():       polls a call's current status and structured data result.

Both functions return a dict on success. On failure they return {"error": str(e)}
so that callers can gracefully fall back to simulation without raising exceptions.
"""

import os
import httpx

VAPI_API_KEY  = os.environ.get("VAPI_API_KEY")
VAPI_BASE_URL = "https://api.vapi.ai"


def trigger_outbound_call(
    assistant_id: str,
    phone_number_id: str,
    customer_number: str,
) -> dict:
    """
    Trigger a real outbound call via Vapi.

    Args:
        assistant_id:    The Vapi assistant ID configured in the dashboard.
        phone_number_id: The Vapi phone number ID to call from.
        customer_number: The E.164 phone number to call (e.g. "+12025551234").

    Returns:
        The Vapi call object dict (includes "id" for status polling), or
        {"error": "<message>"} if the request fails.
    """
    if not VAPI_API_KEY:
        return {"error": "VAPI_API_KEY environment variable not set"}

    headers = {
        "Authorization": f"Bearer {VAPI_API_KEY}",
        "Content-Type":  "application/json",
    }
    payload = {
        "assistantId":   assistant_id,
        "phoneNumberId": phone_number_id,
        "customer":      {"number": customer_number},
    }

    try:
        response = httpx.post(
            f"{VAPI_BASE_URL}/call",
            json=payload,
            headers=headers,
            timeout=10,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as e:
        error_body = ""
        try:
            error_body = e.response.text
        except Exception:
            pass
        return {"error": f"HTTP {e.response.status_code}: {error_body or str(e)}"}
    except httpx.RequestError as e:
        return {"error": f"Request error: {str(e)}"}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}"}


def get_call_status(call_id: str) -> dict:
    """
    Fetch the current status and result of a Vapi call by its ID.

    Args:
        call_id: The Vapi call ID returned by trigger_outbound_call().

    Returns:
        The Vapi call object dict (includes "status", "analysis", "endedAt"), or
        {"error": "<message>"} if the request fails.

    Useful fields in the response when status == "ended":
        response["analysis"]["structuredData"]["price"]
        response["analysis"]["structuredData"]["lead_time_days"]
        response["analysis"]["structuredData"]["availability"]
        response["endedAt"]
    """
    if not VAPI_API_KEY:
        return {"error": "VAPI_API_KEY environment variable not set"}

    headers = {"Authorization": f"Bearer {VAPI_API_KEY}"}

    try:
        response = httpx.get(
            f"{VAPI_BASE_URL}/call/{call_id}",
            headers=headers,
            timeout=10,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as e:
        error_body = ""
        try:
            error_body = e.response.text
        except Exception:
            pass
        return {"error": f"HTTP {e.response.status_code}: {error_body or str(e)}"}
    except httpx.RequestError as e:
        return {"error": f"Request error: {str(e)}"}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}"}
