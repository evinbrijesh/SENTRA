"""
/alerts route — Active Alerting & Incident Notification Engine.

Generates real-time operational alerts for:
- Critical ring detections (Score >= 0.80)
- High velocity bursts (Burst window <= 30 mins)
- Circular referral networks detected
- Webhook simulation for Slack / PagerDuty / Enterprise Risk feeds.
"""

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api import rings_service, state

log = logging.getLogger("api.routes.alerts")

router = APIRouter()

_ALERTS_LOCK = threading.Lock()
_ACKNOWLEDGED_ALERTS: set[str] = set()


class WebhookTestRequest(BaseModel):
    endpoint_url: str = Field(default="https://hooks.slack.com/services/SENTRA/RISK/ALERTS", description="Target Webhook URL")
    channel: str = Field(default="#risk-sentinel-critical", description="Notification target channel")


@router.get("/alerts")
def get_alerts():
    """Evaluate active batch and return real-time operational alerts with severity ranking."""
    data_dir = state.get_active_data_dir()
    try:
        run = rings_service.run_detection(data_dir)
    except Exception as e:  # noqa: BLE001
        log.warning("Could not run detection for alerts: %s", e)
        return {"alerts": [], "unread_count": 0}

    alerts = []
    detected_at = run.get("detected_at", datetime.now(timezone.utc).isoformat())

    # Check flagged rings
    for ring in run.get("flagged", []):
        ring_id = str(ring["component_id"])
        score = ring.get("ring_score", 0.0)
        size = ring.get("size", 0)
        has_cycle = ring.get("has_referral_cycle", False)
        burst_mins = ring.get("temporal", {}).get("burst_minutes", 9999)
        exposure_gmv = ring.get("estimated_exposure_gmv", 0.0)

        # Generate Critical Alert if score >= 0.8 or has referral cycle
        severity = "CRITICAL" if (score >= 0.80 or has_cycle) else "HIGH"
        reasons = []
        if score >= 0.80:
            reasons.append(f"High risk score ({score:.2f})")
        if has_cycle:
            reasons.append("Closed referral cycle gaming")
        if burst_mins <= 60:
            reasons.append(f"Fast velocity burst ({burst_mins:.0f}m)")

        alert_id = f"alt-flag-{ring_id}"
        with _ALERTS_LOCK:
            is_ack = alert_id in _ACKNOWLEDGED_ALERTS

        alerts.append({
            "alert_id": alert_id,
            "severity": severity,
            "title": f"Critical Fraud Ring #{ring_id} ({size} Accounts)",
            "message": f"Coordinated ring detected with {', '.join(reasons) if reasons else 'correlated entities'}.",
            "ring_id": ring_id,
            "score": score,
            "size": size,
            "exposure_gmv": exposure_gmv,
            "timestamp": detected_at,
            "acknowledged": is_ack,
            "signals": ring.get("primary_signals", []),
        })

    # Check Needs Review rings for review queue notifications
    for ring in run.get("needs_review", []):
        ring_id = str(ring["component_id"])
        score = ring.get("ring_score", 0.0)
        size = ring.get("size", 0)
        alert_id = f"alt-rev-{ring_id}"
        with _ALERTS_LOCK:
            is_ack = alert_id in _ACKNOWLEDGED_ALERTS

        alerts.append({
            "alert_id": alert_id,
            "severity": "WARNING",
            "title": f"Borderline Ring #{ring_id} Pending Review",
            "message": f"Risk score {score:.2f} requires human analyst triage.",
            "ring_id": ring_id,
            "score": score,
            "size": size,
            "exposure_gmv": ring.get("estimated_exposure_gmv", 0.0),
            "timestamp": detected_at,
            "acknowledged": is_ack,
            "signals": ring.get("primary_signals", []),
        })

    alerts.sort(key=lambda a: (0 if a["severity"] == "CRITICAL" else 1, not a["acknowledged"], -a["score"]))
    unread_count = sum(1 for a in alerts if not a["acknowledged"])

    return {
        "alerts": alerts,
        "unread_count": unread_count,
        "total_active": len(alerts),
        "generated_at": detected_at,
    }


@router.post("/alerts/{alert_id}/ack")
def acknowledge_alert(alert_id: str):
    """Mark an alert as acknowledged by analyst."""
    with _ALERTS_LOCK:
        _ACKNOWLEDGED_ALERTS.add(alert_id)
    return {"status": "success", "alert_id": alert_id, "acknowledged": True}


@router.post("/alerts/webhook/test")
def trigger_webhook_test(req: WebhookTestRequest):
    """Simulate outbound webhook payload delivery for Slack / PagerDuty."""
    data_dir = state.get_active_data_dir()
    run = rings_service.run_detection(data_dir)
    flagged_count = len(run.get("flagged", []))
    review_count = len(run.get("needs_review", []))

    payload = {
        "event": "SENTRA_ALERT_DISPATCH",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "Sentra Abuse-Ring Sentinel v0.1.0",
        "channel": req.channel,
        "summary": f"🚨 [SENTRA RISK ALERT] {flagged_count} Coordinated Fraud Rings Flagged on Active Batch",
        "details": {
            "critical_rings": flagged_count,
            "pending_review": review_count,
            "target_endpoint": req.endpoint_url,
            "action_required": "Triage investigation queue immediately in Sentra Ops Console.",
        },
        "sample_incident": (
            {
                "ring_id": run["flagged"][0]["component_id"],
                "score": run["flagged"][0]["ring_score"],
                "members": run["flagged"][0]["size"],
                "signals": run["flagged"][0].get("primary_signals", []),
            }
            if flagged_count > 0
            else None
        ),
    }

    log.info("Webhook dispatch simulated to %s -> 200 OK", req.endpoint_url)
    return {
        "status": "delivered",
        "status_code": 200,
        "endpoint": req.endpoint_url,
        "dispatched_payload": payload,
    }
