"""
/audit route — an honest, traceable activity log derived from the actual
detection run (not a fabricated event stream). Each flagged / needs-review ring
becomes an auditable event with its real explanation summary, so a reviewer can
click through to see exactly why it was flagged.
"""

import logging

from fastapi import APIRouter

from api import rings_service
from api import state

log = logging.getLogger("api.routes.audit")

router = APIRouter()


@router.get("/audit")
def get_audit():
    run = rings_service.run_detection(state.get_active_data_dir())
    detected_at = run.get("detected_at")

    events = [
        {
            "event_id": f"run-{detected_at}",
            "type": "detection_run",
            "ring_id": None,
            "ts": detected_at,
            "actor": "SYSTEM",
            "status": "SUCCESS",
            "summary": "Detection run completed on active batch",
            "flagged": len(run.get("flagged", [])),
            "needs_review": len(run.get("needs_review", [])),
            "primary_signals": [],
        }
    ]

    for category in ("flagged", "needs_review"):
        for ring in run[category]:
            exp = ring.get("explanation") or {}
            events.append(
                {
                    "event_id": f"ring-{ring['component_id']}",
                    "type": "ring_flagged" if category == "flagged" else "ring_review",
                    "ring_id": ring["component_id"],
                    "ts": ring.get("detected_at") or detected_at,
                    "actor": "SYSTEM",
                    "status": "FLAGGED" if category == "flagged" else "REVIEW",
                    "ring_score": ring["ring_score"],
                    "size": ring["size"],
                    "summary": exp.get("summary", ""),
                    "primary_signals": ring.get("primary_signals", []),
                }
            )

    events.sort(key=lambda e: e["ts"] or "", reverse=True)
    return {"generated_at": detected_at, "events": events}
