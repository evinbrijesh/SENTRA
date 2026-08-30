"""
/audit route — Legal-grade Cryptographic Audit Ledger API.

Serves the SHA-256 hash-chained immutable activity log with tamper-evident
verification and regulatory model metadata for compliance reporting (RBI / FinCEN).
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter

from api import audit_ledger
from api import rings_service
from api import state

log = logging.getLogger("api.routes.audit")

router = APIRouter()


def _ensure_bootstrap_detection_events() -> None:
    """If audit ledger is fresh, seed the initial batch run and flagged rings as genesis chain blocks."""
    events = audit_ledger.get_ledger_events(limit=1)
    if not events:
        data_dir = state.get_active_data_dir()
        try:
            run = rings_service.run_detection(data_dir)
            detected_at = run.get("detected_at", datetime.now(timezone.utc).isoformat())

            # Seed system run block
            audit_ledger.append_event(
                action_type="SYSTEM_DETECTION_RUN",
                actor="SYSTEM_DETECTOR (v1.0.0)",
                summary=f"Automated risk detection run executed on active batch ({data_dir})",
                evidence={
                    "flagged_rings": len(run.get("flagged", [])),
                    "needs_review_rings": len(run.get("needs_review", [])),
                    "monitored_accounts": run.get("operational_summary", {}).get("total_accounts_monitored", 500),
                },
                status="COMPLETED",
            )

            # Seed ring blocks
            for ring in run.get("flagged", []):
                exp = ring.get("explanation") or {}
                audit_ledger.append_event(
                    action_type="RING_FLAGGED_CRITICAL",
                    actor="AUTOMATED_RISK_RULESET",
                    summary=exp.get("summary", f"Coordinated ring #{ring['component_id']} flagged"),
                    ring_id=str(ring["component_id"]),
                    evidence={
                        "ring_score": ring.get("ring_score"),
                        "size": ring.get("size"),
                        "primary_signals": ring.get("primary_signals", []),
                        "has_referral_cycle": ring.get("has_referral_cycle", False),
                        "estimated_exposure_gmv": ring.get("estimated_exposure_gmv", 0.0),
                    },
                    status="FLAGGED",
                )

            for ring in run.get("needs_review", []):
                exp = ring.get("explanation") or {}
                audit_ledger.append_event(
                    action_type="RING_ROUTED_HUMAN_REVIEW",
                    actor="DECISION_TRIAGE_ENGINE",
                    summary=exp.get("summary", f"Ring #{ring['component_id']} routed to human review queue"),
                    ring_id=str(ring["component_id"]),
                    evidence={
                        "ring_score": ring.get("ring_score"),
                        "size": ring.get("size"),
                        "primary_signals": ring.get("primary_signals", []),
                        "estimated_exposure_gmv": ring.get("estimated_exposure_gmv", 0.0),
                    },
                    status="NEEDS_REVIEW",
                )
        except Exception as e:  # noqa: BLE001
            log.warning("Could not bootstrap audit ledger from active batch: %s", e)


@router.get("/audit")
def get_audit():
    _ensure_bootstrap_detection_events()
    events = audit_ledger.get_ledger_events(limit=200)
    verification = audit_ledger.verify_ledger()

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_events": len(events),
        "cryptographic_verification": verification,
        "events": events,
    }


@router.get("/audit/verify")
def verify_audit_chain():
    """Verify cryptographic SHA-256 Merkle hash chain integrity."""
    _ensure_bootstrap_detection_events()
    return audit_ledger.verify_ledger()
