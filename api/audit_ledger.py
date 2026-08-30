"""
Cryptographic SHA-256 Immutable Audit Ledger.

Provides regulator-grade auditability (RBI / FinCEN / SEBI compliance):
- Every detection run, model inference, and analyst decision is recorded as an immutable, hash-chained block.
- Blocks are linked via Merkle/blockchain-style SHA-256 hash pointers:
    event_hash = SHA256(prev_hash + canonical_json(event_data))
- Dual persistence: Postgres table audit_ledger with fallback to data/audit/audit_ledger.jsonl.
- Tamper verification: Reconstructs and cryptographically validates the entire chain on demand.
"""

import hashlib
import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api import db

log = logging.getLogger("api.audit_ledger")

GENESIS_HASH = "0" * 64
AUDIT_DIR = Path("data/audit")
AUDIT_JSONL_PATH = AUDIT_DIR / "audit_ledger.jsonl"
_LEDGER_LOCK = threading.Lock()

# In-memory chain cache
_CHAIN_CACHE: list[dict] = []
_INITIALIZED = False


def _canonical_json(data: Any) -> bytes:
    """Produce deterministic JSON representation for reproducible hashing."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


def _compute_hash(prev_hash: str, payload: dict) -> str:
    """Compute SHA-256 hash of previous hash concatenated with canonical event payload."""
    clean_payload = {k: v for k, v in payload.items() if k not in ("event_hash", "signature")}
    hasher = hashlib.sha256()
    hasher.update(prev_hash.encode("utf-8"))
    hasher.update(_canonical_json(clean_payload))
    return hasher.hexdigest()


def _ensure_pg_table(conn) -> None:
    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_ledger (
                block_index INT PRIMARY KEY,
                event_id TEXT NOT NULL,
                event_hash TEXT NOT NULL,
                prev_hash TEXT NOT NULL,
                action_type TEXT NOT NULL,
                actor TEXT NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                payload JSONB NOT NULL
            );
            """
        )
        conn.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("Could not ensure audit_ledger table in Postgres: %s", e)


def _load_ledger_from_disk() -> list[dict]:
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    if not AUDIT_JSONL_PATH.exists():
        return []
    chain = []
    with open(AUDIT_JSONL_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    chain.append(json.loads(line))
                except Exception:
                    continue
    return chain


def _save_block_to_disk(block: dict) -> None:
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    with open(AUDIT_JSONL_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(block, sort_keys=True, default=str) + "\n")


def init_ledger() -> None:
    """Initialize ledger from Postgres or JSONL on startup."""
    global _CHAIN_CACHE, _INITIALIZED
    with _LEDGER_LOCK:
        if _INITIALIZED:
            return

        chain = []
        if db.pg_available():
            try:
                with db.pg_cursor() as cur:
                    _ensure_pg_table(cur.connection)
                    cur.execute(
                        "SELECT block_index, event_id, event_hash, prev_hash, action_type, actor, timestamp, payload FROM audit_ledger ORDER BY block_index ASC"
                    )
                    rows = cur.fetchall()
                    for r in rows:
                        block = dict(r[7])  # payload
                        block["block_index"] = r[0]
                        block["event_id"] = r[1]
                        block["event_hash"] = r[2]
                        block["prev_hash"] = r[3]
                        block["action_type"] = r[4]
                        block["actor"] = r[5]
                        block["timestamp"] = str(r[6])
                        chain.append(block)
            except Exception as e:  # noqa: BLE001
                log.warning("Failed loading audit ledger from Postgres: %s", e)

        if not chain:
            chain = _load_ledger_from_disk()

        _CHAIN_CACHE = chain
        _INITIALIZED = True
        log.info("Audit Ledger initialized with %d cryptographically chained blocks", len(_CHAIN_CACHE))


def append_event(
    action_type: str,
    actor: str,
    summary: str,
    ring_id: str | None = None,
    evidence: dict | None = None,
    status: str = "COMPLETED",
    metadata: dict | None = None,
) -> dict:
    """Append a new tamper-evident event to the cryptographic audit ledger."""
    init_ledger()
    with _LEDGER_LOCK:
        block_index = len(_CHAIN_CACHE)
        prev_hash = _CHAIN_CACHE[-1]["event_hash"] if _CHAIN_CACHE else GENESIS_HASH

        now_iso = datetime.now(timezone.utc).isoformat()
        event_id = f"evt-{block_index:06d}-{int(datetime.now(timezone.utc).timestamp())}"

        # Model / policy versioning for regulator replay
        threshold_info = _get_threshold_info()

        event_payload = {
            "block_index": block_index,
            "event_id": event_id,
            "prev_hash": prev_hash,
            "timestamp": now_iso,
            "action_type": action_type,
            "actor": actor,
            "status": status,
            "ring_id": ring_id,
            "summary": summary,
            "evidence": evidence or {},
            "model_metadata": {
                "model_name": threshold_info.get("model_name", "RandomForest"),
                "threshold": threshold_info.get("threshold", 0.50),
                "model_version": threshold_info.get("version", "v1.0-dual-eval"),
            },
            "system_metadata": metadata or {},
        }

        event_hash = _compute_hash(prev_hash, event_payload)
        event_payload["event_hash"] = event_hash

        _CHAIN_CACHE.append(event_payload)
        _save_block_to_disk(event_payload)

        # Try persisting to Postgres
        if db.pg_available():
            try:
                with db.pg_cursor() as cur:
                    _ensure_pg_table(cur.connection)
                    cur.execute(
                        """
                        INSERT INTO audit_ledger (block_index, event_id, event_hash, prev_hash, action_type, actor, timestamp, payload)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (block_index) DO NOTHING
                        """,
                        (
                            block_index,
                            event_id,
                            event_hash,
                            prev_hash,
                            action_type,
                            actor,
                            now_iso,
                            json.dumps(event_payload),
                        ),
                    )
            except Exception as e:  # noqa: BLE001
                log.warning("Could not persist audit block %d to Postgres: %s", block_index, e)

        return event_payload


def get_ledger_events(limit: int = 100) -> list[dict]:
    """Return all ledger events (most recent first)."""
    init_ledger()
    with _LEDGER_LOCK:
        events = list(reversed(_CHAIN_CACHE))
        return events[:limit]


def verify_ledger() -> dict:
    """Cryptographically verify the entire SHA-256 hash chain from genesis block to head."""
    init_ledger()
    with _LEDGER_LOCK:
        if not _CHAIN_CACHE:
            return {
                "integrity_status": "EMPTY",
                "valid": True,
                "chain_length": 0,
                "genesis_hash": GENESIS_HASH,
                "head_hash": GENESIS_HASH,
                "message": "Ledger is empty (0 blocks).",
                "verified_at": datetime.now(timezone.utc).isoformat(),
            }

        expected_prev = GENESIS_HASH
        for idx, block in enumerate(_CHAIN_CACHE):
            actual_prev = block.get("prev_hash")
            if actual_prev != expected_prev:
                return {
                    "integrity_status": "TAMPERED",
                    "valid": False,
                    "chain_length": len(_CHAIN_CACHE),
                    "broken_at_block": idx,
                    "error": f"Block {idx} prev_hash mismatch: expected {expected_prev}, got {actual_prev}",
                    "verified_at": datetime.now(timezone.utc).isoformat(),
                }

            expected_hash = _compute_hash(actual_prev, block)
            actual_hash = block.get("event_hash")
            if actual_hash != expected_hash:
                return {
                    "integrity_status": "TAMPERED",
                    "valid": False,
                    "chain_length": len(_CHAIN_CACHE),
                    "broken_at_block": idx,
                    "error": f"Block {idx} hash corrupted: expected {expected_hash}, stored {actual_hash}",
                    "verified_at": datetime.now(timezone.utc).isoformat(),
                }

            expected_prev = actual_hash

        return {
            "integrity_status": "VERIFIED",
            "valid": True,
            "chain_length": len(_CHAIN_CACHE),
            "genesis_hash": _CHAIN_CACHE[0]["event_hash"],
            "head_hash": _CHAIN_CACHE[-1]["event_hash"],
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "algorithm": "SHA-256 Hash Chaining (Merkle Sequential)",
        }


def _get_threshold_info() -> dict:
    threshold_path = Path("detection/model/threshold.json")
    if threshold_path.exists():
        try:
            return json.loads(threshold_path.read_text())
        except Exception:
            pass
    return {"model_name": "RandomForestClassifier", "threshold": 0.50, "version": "v1.0.0-dual-eval"}
