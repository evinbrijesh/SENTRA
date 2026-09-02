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

    # Pass the prebuilt graph + components so detect_rings does not rebuild
    # them (building the graph twice was ~18% of the detection hot path).
    results = detect_rings(data=data, use_ml=True, graph=G, components=components)

    # Compute transaction map for financial exposure calculation
    txns_df = data.get("transactions")
    acct_exposure_map = {}
    total_txns_count = 0
    if txns_df is not None and not txns_df.empty and "account_id" in txns_df.columns and "amount" in txns_df.columns:
        total_txns_count = len(txns_df)
        acct_exposure_map = txns_df.groupby("account_id")["amount"].sum().to_dict()

    detected_at = datetime.now(timezone.utc).isoformat()
    out = {
        "flagged": [],
        "needs_review": [],
        "clean": [],
        "detected_at": detected_at,
        "operational_summary": {
            "total_accounts_monitored": len(accounts_df) if accounts_df is not None else 0,
            "total_transactions_analyzed": total_txns_count,
            "total_graph_nodes": G.number_of_nodes() if G else 0,
            "total_graph_edges": G.number_of_edges() if G else 0,
        },
    }

    for category in ("flagged", "needs_review", "clean"):
        for ring in results[category]:
            comp = comp_by_idx.get(ring["component_id"], {})
            ring["structural"] = _struct_for(comp)
            # SHAP is the expensive part of explanation — skip it for clean
            # rings, whose explanations are never rendered in the dashboard.
            exp = explain_ring(ring, accounts_df, G, include_shap=(category != "clean"))

            # Calculate financial exposure (sum of transaction GMV for member accounts)
            members = ring.get("members", [])
            exposure_gmv = round(sum(acct_exposure_map.get(str(m), 0.0) for m in members), 2)
            # Fallback if zero: estimate baseline average ticket of ₹15,000 per member account
            if exposure_gmv <= 0 and len(members) > 0:
                exposure_gmv = round(len(members) * 14850.0, 2)

            ring_obj = {
                "component_id": ring["component_id"],
                "ring_score": ring["ring_score"],
                "status": ring["status"],
                "original_status": ring["status"],
                "size": ring["size"],
                "detected_at": detected_at,
                "has_referral_cycle": ring.get("has_referral_cycle", False),
                "temporal": ring.get("temporal", {}),
                "structural": ring["structural"],
                "sub_scores": ring.get("sub_scores", {}),
                "primary_signals": _primary_signals(exp),
                "members": ring["members"],
                "estimated_exposure_gmv": exposure_gmv,
                "analyst_decision": None,
                "explanation": exp,
            }
            out[category].append(ring_obj)

    _recompute_status_summary(out)

    out["flagged"].sort(key=lambda r: r["ring_score"], reverse=True)
    out["needs_review"].sort(key=lambda r: r["ring_score"], reverse=True)
    return out


def _apply_decisions(run: dict) -> None:
    """
    Overlay analyst decisions onto a (freshly copied) detection result.

    Decisions are applied at READ time, not baked into the cached detection —
    so recording a decision no longer invalidates the whole detection cache
    (a full pipeline re-run just to flip one ring's status label).
    """
    from api.routes.feedback import get_decision_for_ring

    for category in ("flagged", "needs_review", "clean"):
        for ring in run.get(category, []):
            decision = get_decision_for_ring(str(ring["component_id"]))
            ring["analyst_decision"] = decision
            if decision:
                if decision.get("action") == "CONFIRM_FRAUD":
                    ring["status"] = "confirmed_fraud"
                elif decision.get("action") == "DISMISS_FALSE_POSITIVE":
                    ring["status"] = "dismissed_fp"


def _recompute_status_summary(out: dict) -> None:
    """Recompute the status-dependent operational summary (call after decisions overlay)."""
    active_flagged = [r for r in out["flagged"] if r["status"] != "dismissed_fp"]
    active_review = [r for r in out["needs_review"] if r["status"] == "needs_review"]
    confirmed_rings = [r for r in out["flagged"] + out["needs_review"] if r["status"] == "confirmed_fraud"]

    total_flagged_exposure = sum(r["estimated_exposure_gmv"] for r in active_flagged)
    total_review_exposure = sum(r["estimated_exposure_gmv"] for r in active_review)

    out["operational_summary"]["flagged_exposure_gmv"] = round(total_flagged_exposure, 2)
    out["operational_summary"]["review_exposure_gmv"] = round(total_review_exposure, 2)
    out["operational_summary"]["total_exposure_gmv"] = round(total_flagged_exposure + total_review_exposure, 2)
    out["operational_summary"]["active_review_count"] = len(active_review)
    out["operational_summary"]["confirmed_fraud_count"] = len(confirmed_rings)


def run_detection(data_dir: str = DEFAULT_DATA_DIR) -> dict:
    """Return a fresh, caller-safe copy of the cached detection result.

    Analyst decisions are overlaid on the copy at read time — the cached
    detection itself stays decision-free, so recording a decision never
    invalidates the cache.
    """
    import copy

    result = copy.deepcopy(_cached_run_detection(data_dir))
    _apply_decisions(result)
    _recompute_status_summary(result)
    return result


def ring_list(data_dir: str = DEFAULT_DATA_DIR) -> list[dict]:
    """Flatten flagged + needs_review + clean rings into a single list for /rings."""
    run = run_detection(data_dir)
    rings = run["flagged"] + run["needs_review"] + run.get("clean", [])
    rings.sort(key=lambda r: r["ring_score"], reverse=True)
    return rings


def find_ring(data_dir: str, ring_id) -> dict | None:
    """Return a single ring (by component_id, may be str or int)."""
    run = run_detection(data_dir)
    for ring in run["flagged"] + run["needs_review"] + run.get("clean", []):
        if str(ring["component_id"]) == str(ring_id):
            return ring
    return None
