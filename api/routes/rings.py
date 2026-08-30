"""
/rings routes — ring list, ring detail (with shared entities), and subgraph
for Cytoscape.js.
"""

import logging

from fastapi import APIRouter, HTTPException

from api import rings_service
from api import neo4j_queries
from api import state
from api.db import neo4j_available
from detection.graph_queries import build_graph, get_subgraph_json, load_csvs

log = logging.getLogger("api.routes.rings")

router = APIRouter()


def _data_dir() -> str:
    return state.get_active_data_dir()


@router.get("/rings")
def list_rings():
    try:
        rings = rings_service.ring_list(_data_dir())
    except Exception as e:  # noqa: BLE001
        log.error("failed to list rings: %s", e)
        raise HTTPException(status_code=500, detail=f"Detection failed: {e}")
    # Drop heavy fields from the list view for a leaner payload.
    for r in rings:
        r.pop("explanation", None)
        r.pop("members", None)
    return rings


@router.get("/rings/summary")
def get_rings_summary():
    """Return live operational batch summary (total monitored accounts, transactions, GMV exposure)."""
    try:
        run = rings_service.run_detection(_data_dir())
        return {
            "operational_summary": run.get("operational_summary", {}),
            "flagged_count": len(run.get("flagged", [])),
            "needs_review_count": len(run.get("needs_review", [])),
            "clean_count": len(run.get("clean", [])),
            "detected_at": run.get("detected_at"),
        }
    except Exception as e:  # noqa: BLE001
        log.error("failed to get summary: %s", e)
        raise HTTPException(status_code=500, detail=f"Summary failed: {e}")


@router.get("/rings/{ring_id}")
def get_ring(ring_id: str):
    ring = rings_service.find_ring(_data_dir(), ring_id)
    if ring is None:
        raise HTTPException(status_code=404, detail=f"Ring '{ring_id}' not found")
    ring["shared_entities"] = _shared_entities(ring)
    return ring


@router.get("/rings/{ring_id}/subgraph")
def get_subgraph(ring_id: str):
    ring = rings_service.find_ring(_data_dir(), ring_id)
    if ring is None:
        raise HTTPException(status_code=404, detail=f"Ring '{ring_id}' not found")
    members = ring.get("members", [])

    if neo4j_available():
        try:
            return neo4j_queries.get_subgraph(members)
        except Exception as e:  # noqa: BLE001
            log.warning("neo4j subgraph failed, falling back to CSV: %s", e)

    # CSV-backed fallback (the proven detection graph).
    data = load_csvs(_data_dir())
    G = build_graph(data)
    return get_subgraph_json(G, members)


def _shared_entities(ring: dict) -> dict:
    members = ring.get("members", [])
    if neo4j_available():
        try:
            entities = neo4j_queries.get_shared_entities(members)
            entities["source"] = "neo4j"
            return entities
        except Exception as e:  # noqa: BLE001
            log.warning("neo4j shared entities failed, falling back: %s", e)

    unique_devices = ring["structural"].get("unique_devices", 0)
    unique_ips = ring["structural"].get("unique_ips", 0)
    size = ring["size"]
    accts_per_device = round(size / unique_devices) if unique_devices > 0 else 0
    accts_per_ip = round(size / unique_ips) if unique_ips > 0 else 0
    entities = {
        "devices": [{"id": f"DEV-{i}", "accounts": accts_per_device} for i in range(unique_devices)],
        "ips": [{"id": f"IP-{i}", "accounts": accts_per_ip} for i in range(unique_ips)],
        "payment_methods": [],
        "has_referral_cycle": ring.get("has_referral_cycle", False),
        "source": "detection",
    }
    return entities
