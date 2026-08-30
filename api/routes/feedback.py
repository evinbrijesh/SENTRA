"""
/feedback route — Analyst Human-In-The-Loop (HITL) decisions.

Allows risk analysts to:
1. Confirm a detected ring as genuine coordinated fraud (CONFIRM_FRAUD)
2. Dismiss a ring as a false positive (DISMISS_FALSE_POSITIVE)

Decisions persist in Postgres (table `analyst_decisions`) with local file fallback,
and append an immutable cryptographic event to the `audit_ledger`.
"""

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api import audit_ledger, db, state
from api import rings_service

log = logging.getLogger("api.routes.feedback")

router = APIRouter()

DECISIONS_DIR = Path("data/feedback")
DECISIONS_FILE = DECISIONS_DIR / "analyst_decisions.json"
_DECISIONS_LOCK = threading.Lock()
_DECISIONS_CACHE: dict[str, dict] = {}
_INITIALIZED = False


class DecisionRequest(BaseModel):
    action: Literal["CONFIRM_FRAUD", "DISMISS_FALSE_POSITIVE", "FLAG_ESCALATION"]
    analyst_id: str = Field(default="analyst_rzp_ops_01", description="ID of the reviewing risk analyst")
    notes: str = Field(default="", description="Investigator rationale / evidence notes")
    analyst_role: str = Field(default="L2_RISK_INVESTIGATOR", description="Role/authority of analyst")


def _ensure_pg_decisions_table(conn) -> None:
    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS analyst_decisions (
                ring_id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                analyst_id TEXT NOT NULL,
                analyst_role TEXT NOT NULL,
                notes TEXT,
                decided_at TIMESTAMP NOT NULL,
                payload JSONB NOT NULL
            );
            """
        )
        conn.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("Could not create analyst_decisions table: %s", e)


def _load_decisions() -> dict[str, dict]:
    global _DECISIONS_CACHE, _INITIALIZED
    with _DECISIONS_LOCK:
        if _INITIALIZED:
            return _DECISIONS_CACHE

        decisions = {}
        if db.pg_available():
            try:
                with db.pg_cursor() as cur:
                    _ensure_pg_decisions_table(cur.connection)
                    cur.execute(
                        "SELECT ring_id, action, analyst_id, analyst_role, notes, decided_at, payload FROM analyst_decisions"
                    )
                    for r in cur.fetchall():
                        decisions[str(r[0])] = dict(r[6])
            except Exception as e:  # noqa: BLE001
                log.warning("Failed loading decisions from Postgres: %s", e)

        if not decisions and DECISIONS_FILE.exists():
            try:
                decisions = json.loads(DECISIONS_FILE.read_text())
            except Exception:
                decisions = {}

        _DECISIONS_CACHE = decisions
        _INITIALIZED = True
        return _DECISIONS_CACHE


def get_decision_for_ring(ring_id: str) -> dict | None:
    decisions = _load_decisions()
    with _DECISIONS_LOCK:
        return decisions.get(str(ring_id))


def get_all_decisions() -> dict[str, dict]:
    return dict(_load_decisions())


@router.post("/rings/{ring_id}/decision")
def record_decision(ring_id: str, req: DecisionRequest):
    data_dir = state.get_active_data_dir()
    ring = rings_service.find_ring(data_dir, ring_id)
    if ring is None:
        raise HTTPException(status_code=404, detail=f"Ring '{ring_id}' not found in active batch")

    now_iso = datetime.now(timezone.utc).isoformat()
    decision_record = {
        "ring_id": str(ring_id),
        "action": req.action,
        "analyst_id": req.analyst_id,
        "analyst_role": req.analyst_role,
        "notes": req.notes,
        "decided_at": now_iso,
        "ring_score": ring.get("ring_score"),
        "ring_size": ring.get("size"),
        "member_count": len(ring.get("members", [])),
    }

    # Save in memory
    _load_decisions()
    with _DECISIONS_LOCK:
        _DECISIONS_CACHE[str(ring_id)] = decision_record

        # Save to disk
        DECISIONS_DIR.mkdir(parents=True, exist_ok=True)
        DECISIONS_FILE.write_text(json.dumps(_DECISIONS_CACHE, indent=2))

    # Persist to Postgres
    if db.pg_available():
        try:
            with db.pg_cursor() as cur:
                _ensure_pg_decisions_table(cur.connection)
                cur.execute(
                    """
                    INSERT INTO analyst_decisions (ring_id, action, analyst_id, analyst_role, notes, decided_at, payload)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (ring_id) DO UPDATE SET
                        action = EXCLUDED.action,
                        analyst_id = EXCLUDED.analyst_id,
                        notes = EXCLUDED.notes,
                        decided_at = EXCLUDED.decided_at,
                        payload = EXCLUDED.payload
                    """,
                    (
                        str(ring_id),
                        req.action,
                        req.analyst_id,
                        req.analyst_role,
                        req.notes,
                        now_iso,
                        json.dumps(decision_record),
                    ),
                )
        except Exception as e:  # noqa: BLE001
            log.warning("Could not persist decision to Postgres: %s", e)

    # Append to Immutable Cryptographic Audit Ledger
    action_title = "ANALYST_CONFIRMED_FRAUD" if req.action == "CONFIRM_FRAUD" else "ANALYST_DISMISSED_FP"
    summary_text = (
        f"Analyst {req.analyst_id} confirmed Ring #{ring_id} as coordinated fraud"
        if req.action == "CONFIRM_FRAUD"
        else f"Analyst {req.analyst_id} dismissed Ring #{ring_id} as false positive (Notes: {req.notes or 'None'})"
    )

    audit_ledger.append_event(
        action_type=action_title,
        actor=f"{req.analyst_id} ({req.analyst_role})",
        summary=summary_text,
        ring_id=str(ring_id),
        details={
            "action": req.action,
            "analyst_id": req.analyst_id,
            "analyst_role": req.analyst_role,
            "notes": req.notes,
            "ring_score": ring.get("ring_score"),
            "ring_size": ring.get("size"),
            "member_count": len(ring.get("members", [])),
        },
    )

    # Invalidate detection cache so all endpoints reflect the updated status immediately
    rings_service.clear_detection_cache()

    return {
        "status": "ok",
        "message": f"Decision '{req.action}' recorded and cryptographically sealed into audit ledger",
        "decision": decision_record,
    }


@router.get("/feedback/decisions")
def list_decisions():
    return {"decisions": get_all_decisions()}
