"""
services/alerts.py
ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
Multi-Channel Alerts ΓÇö Slack integration.

Design principles
-----------------
ΓÇó Graceful no-op: if SLACK_WEBHOOK_URL is not set in the environment the
  function returns immediately without raising, so the caller is never
  affected by an unconfigured channel.
ΓÇó Zero new dependencies: uses httpx which is already a FastAPI transitive
  dependency and is confirmed available in this environment.
ΓÇó Additive only: nothing in this module imports from or modifies any other
  service file.

Anomaly record structure (from enriched_engine.ANOMALY_RECORDS):
  {
    "store_id":         str   ΓÇö e.g. "S001"
    "product_id":       str   ΓÇö e.g. "P0001"
    "date":             str   ΓÇö ISO date, e.g. "2023-06-15"
    "supplier_id":      str   ΓÇö e.g. "SUP-003"
    "anomaly_reason":   str   ΓÇö one of:
                                  "Price significantly deviates from competitor pricing"
                                  "Order quantity far exceeds demand forecast"
                                  "Both order quantity and price are anomalous"
    "inventory_level":  int
    "units_sold":       int
    "feedback_applied": bool
  }

Severity mapping (derived from anomaly_reason, no new field required):
  "Both order quantity and price are anomalous" ΓåÆ CRITICAL
  "Order quantity far exceeds demand forecast"  ΓåÆ HIGH
  "Price significantly deviates from ..."       ΓåÆ HIGH
  (anything else / unknown)                     ΓåÆ MEDIUM
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("alerts")

# ---------------------------------------------------------------------------
# Severity derivation ΓÇö based on existing anomaly_reason values in the data
# ---------------------------------------------------------------------------

_CRITICAL_REASON = "Both order quantity and price are anomalous"

def _derive_severity(anomaly_record: dict) -> str:
    reason = anomaly_record.get("anomaly_reason", "")
    if reason == _CRITICAL_REASON:
        return "CRITICAL"
    if "quantity" in reason.lower() or "price" in reason.lower():
        return "HIGH"
    return "MEDIUM"


# ---------------------------------------------------------------------------
# Slack message builder
# ---------------------------------------------------------------------------

def _build_slack_message(anomaly_record: dict, severity: str) -> dict:
    """
    Compose a structured Slack Block Kit message from a real anomaly_record dict.
    Falls back to a plain-text message if Block Kit isn't supported.
    """
    store_id        = anomaly_record.get("store_id", "unknown")
    product_id      = anomaly_record.get("product_id", "unknown")
    supplier_id     = anomaly_record.get("supplier_id", "unknown")
    reason          = anomaly_record.get("anomaly_reason", "Anomaly detected")
    date            = anomaly_record.get("date", "unknown")
    inventory_level = anomaly_record.get("inventory_level", "?")
    units_sold      = anomaly_record.get("units_sold", "?")

    severity_emoji = {"CRITICAL": "≡ƒö┤", "HIGH": "≡ƒƒá", "MEDIUM": "≡ƒƒí"}.get(severity, "ΓÜá∩╕Å")

    # Slack Block Kit payload ΓÇö renders nicely in Slack; falls back gracefully
    return {
        "text": f"{severity_emoji} [{severity}] Procurement anomaly flagged ΓÇö {store_id} / {product_id}",
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"{severity_emoji} Procurement Anomaly ΓÇö {severity}",
                    "emoji": True,
                },
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Store:*\n{store_id}"},
                    {"type": "mrkdwn", "text": f"*Product:*\n{product_id}"},
                    {"type": "mrkdwn", "text": f"*Supplier:*\n{supplier_id}"},
                    {"type": "mrkdwn", "text": f"*Date:*\n{date}"},
                    {"type": "mrkdwn", "text": f"*Inventory Level:*\n{inventory_level}"},
                    {"type": "mrkdwn", "text": f"*Units Sold:*\n{units_sold}"},
                ],
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Reason:* {reason}",
                },
            },
            {"type": "divider"},
        ],
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def send_slack_alert(
    anomaly_record: dict,
    min_severity: str = "HIGH",
    timeout: float = 5.0,
) -> dict:
    """
    Send a Slack notification for a flagged anomaly record.

    Parameters
    ----------
    anomaly_record : dict ΓÇö one entry from enriched_engine.ANOMALY_RECORDS
                    (keys: store_id, product_id, supplier_id, anomaly_reason,
                     inventory_level, units_sold, date, feedback_applied).
    min_severity   : Only send if derived severity >= this level.
                    "CRITICAL" | "HIGH" | "MEDIUM" (default "HIGH").
    timeout        : HTTP timeout in seconds (default 5).

    Returns
    -------
    {
        "status": "sent" | "skipped" | "filtered" | "failed",
        "reason": str (when skipped/filtered),
        "severity": str,
        "error":  str (when failed),
    }

    Guarantees
    ----------
    ΓÇó Never raises ΓÇö all exceptions are caught and returned as {"status": "failed"}.
    ΓÇó If SLACK_WEBHOOK_URL env var is absent, returns {"status": "skipped"} immediately.
    ΓÇó If severity < min_severity, returns {"status": "filtered"} without hitting the network.
    """
    webhook_url = os.environ.get("SLACK_WEBHOOK_URL")

    # ΓöÇΓöÇ Graceful no-op if unconfigured ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    if not webhook_url:
        logger.debug("[Alerts] SLACK_WEBHOOK_URL not set ΓÇö skipping Slack alert.")
        return {"status": "skipped", "reason": "no webhook configured"}

    # ΓöÇΓöÇ Severity gate ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    _severity_rank = {"MEDIUM": 0, "HIGH": 1, "CRITICAL": 2}
    severity = _derive_severity(anomaly_record)
    if _severity_rank.get(severity, 0) < _severity_rank.get(min_severity, 1):
        logger.debug(
            "[Alerts] Anomaly severity %s < min_severity %s ΓÇö filtered out.",
            severity, min_severity,
        )
        return {"status": "filtered", "reason": f"severity {severity} < {min_severity}", "severity": severity}

    # ΓöÇΓöÇ Build and send ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    try:
        payload = _build_slack_message(anomaly_record, severity)
        response = httpx.post(webhook_url, json=payload, timeout=timeout)
        response.raise_for_status()

        logger.info(
            "[Alerts] Slack alert sent ΓÇö store=%s product=%s severity=%s reason=%s",
            anomaly_record.get("store_id"),
            anomaly_record.get("product_id"),
            severity,
            anomaly_record.get("anomaly_reason", ""),
        )
        return {"status": "sent", "severity": severity}

    except httpx.HTTPStatusError as exc:
        logger.warning(
            "[Alerts] Slack webhook returned HTTP %d: %s",
            exc.response.status_code, exc.response.text[:200],
        )
        return {"status": "failed", "error": f"HTTP {exc.response.status_code}", "severity": severity}

    except Exception as exc:
        logger.warning("[Alerts] Slack alert failed: %s", exc)
        return {"status": "failed", "error": str(exc), "severity": severity}
