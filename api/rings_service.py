"""
Detection service for the API — composes the proven offline detection engine
(graph_queries + scoring + explain) and shapes the result into the payload the
dashboard expects.

This lives in api/ (not detection/) so the isolation rule holds: detection/
stays free of any API concerns and remains directly unit-testable.

The detection engine reads CSVs directly (the proven, metrics-backed path).
Neo4j is used for the relationship/subgraph reads (see neo4j_queries) so the
graph database is genuinely exercised in the demo.
"""

import copy
import logging
import threading
from datetime import datetime, timezone
from functools import lru_cache

from detection.explain import explain_ring
from detection.graph_queries import build_graph, find_components, load_csvs
from detection.scoring import detect_rings

log = logging.getLogger("api.service")

DEFAULT_DATA_DIR = "data/raw"

# Full detection is expensive (CSV load + graph build + ML). Cache it per data
# dir so /rings, /rings/{id}, and /rings/{id}/subgraph don't each re-run it.
# Callers may mutate the returned dict, so we hand out a fresh deep copy.
_DETECTION_CACHE: dict = {}
_CACHE_LOCK = threading.Lock()


def _cached_run_detection(data_dir: str) -> dict:
    # Fast path — already cached (no lock needed for read once populated).
    if data_dir in _DETECTION_CACHE:
        return _DETECTION_CACHE[data_dir]
    # Slow path — compute under lock so only one thread runs detection per dir.
    with _CACHE_LOCK:
        if data_dir not in _DETECTION_CACHE:
            _DETECTION_CACHE[data_dir] = _compute_detection(data_dir)
    return _DETECTION_CACHE[data_dir]


def clear_detection_cache() -> None:
    with _CACHE_LOCK:
        _DETECTION_CACHE.clear()


def _struct_for(comp: dict) -> dict:
    return {
        "unique_devices": comp.get("unique_devices", 0),
        "unique_ips": comp.get("unique_ips", 0),
        "referral_edges": comp.get("referral_edges", 0),
        "shared_device_edges": comp.get("shared_device_edges", 0),
        "shared_ip_edges": comp.get("shared_ip_edges", 0),
    }


def _primary_signals(explanation: dict) -> list[str]:
    sigs = [r["type"] for r in explanation.get("reasons", [])]
    return sigs[:3] if sigs else ["pattern_normal"]


def _compute_detection(data_dir: str) -> dict:
    """Run detection on a batch dir and return dashboard-shaped rings."""
    data = load_csvs(data_dir)
    accounts_df = data["accounts"]
    G = build_graph(data)
    components = find_components(G)
    comp_by_idx = {c["component_id"]: c for c in components}

    results = detect_rings(data=data, use_ml=True)

    detected_at = datetime.now(timezone.utc).isoformat()
    out = {"flagged": [], "needs_review": [], "clean": [], "detected_at": detected_at}

    for category in ("flagged", "needs_review", "clean"):
        for ring in results[category]:
            comp = comp_by_idx.get(ring["component_id"], {})
            # Attach structural info before calling explain_ring so the
            # explainer can build shared-device / shared-IP reasons.
            ring["structural"] = _struct_for(comp)
            exp = explain_ring(ring, accounts_df, G)
            ring_obj = {
                "component_id": ring["component_id"],
                "ring_score": ring["ring_score"],
                "status": ring["status"],
                "size": ring["size"],
                "detected_at": detected_at,
                "has_referral_cycle": ring.get("has_referral_cycle", False),
                "temporal": ring.get("temporal", {}),
                "structural": ring["structural"],
                "sub_scores": ring.get("sub_scores", {}),
                "primary_signals": _primary_signals(exp),
                "members": ring["members"],
                "explanation": exp,
            }
            out[category].append(ring_obj)

    out["flagged"].sort(key=lambda r: r["ring_score"], reverse=True)
    out["needs_review"].sort(key=lambda r: r["ring_score"], reverse=True)
    return out


def run_detection(data_dir: str = DEFAULT_DATA_DIR) -> dict:
    """Return a fresh, caller-safe copy of the cached detection result."""
    import copy

    return copy.deepcopy(_cached_run_detection(data_dir))


def ring_list(data_dir: str = DEFAULT_DATA_DIR) -> list[dict]:
    """Flatten flagged + needs_review rings into a single list for /rings."""
    run = run_detection(data_dir)
    rings = run["flagged"] + run["needs_review"]
    rings.sort(key=lambda r: r["ring_score"], reverse=True)
    return rings


def find_ring(data_dir: str, ring_id) -> dict | None:
    """Return a single ring (by component_id, may be str or int)."""
    run = run_detection(data_dir)
    for ring in run["flagged"] + run["needs_review"]:
        if str(ring["component_id"]) == str(ring_id):
            return ring
    return None
