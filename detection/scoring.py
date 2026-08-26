"""
Sentra — Ring Scoring Engine

Combines structural, temporal, and referral-cycle signals into a
single ring score (0.0–1.0) using weighted rules.

This is intentionally rule-based (not ML) for:
1. Explainability — every score component is traceable
2. Speed to build — no training data needed
3. Debuggability — thresholds are human-tunable via config

ML upgrade is the stretch goal if time allows (Day 7+).
"""

import os
from pathlib import Path

import pandas as pd

from detection.graph_queries import build_graph, find_components, get_candidate_components, load_csvs
from detection.temporal import compute_cluster_temporal

# ── Scoring weights (tune these on the dev split) ──────────────
# Each signal contributes a sub-score 0–1, weighted and combined.
WEIGHTS = {
    "density": 0.25,       # how tightly connected the component is
    "size_suspect": 0.15,  # ring-sized (10–30) is more suspicious than very small/large
    "device_concentration": 0.20,  # few unique devices = shared device signal
    "ip_concentration": 0.15,      # few unique IPs = shared IP signal
    "referral_density": 0.10,      # high referral edges within component
    "temporal": 0.15,              # tight signup burst
}

# Ring size range: accounts in this range are most suspicious
RING_SIZE_MIN = 10
RING_SIZE_MAX = 30

# ── Temporal gate ──────────────────────────────────────────────
# Minimum temporal sub-score required to flag (kills false-positive
# clusters of normal accounts that share a device/IP but have no
# signup burst).  Has-referral-cycle bypasses this gate.
MIN_TEMPORAL_SCORE = 0.30

# Exponential decay half-life for temporal scoring (minutes)
HALF_LIFE_MINUTES = 360.0


def _density_score(density: float) -> float:
    """
    Map density (0–1) to a suspicion score.
    Dense subgraphs are suspicious; sparse ones are normal.
    """
    # 0.3+ density is very suspicious for groups > 5
    # Scale linearly from 0.1 (low) to 0.5 (high)
    if density < 0.1:
        return 0.0
    if density > 0.5:
        return 1.0
    return (density - 0.1) / 0.4


def _size_suspect_score(size: int) -> float:
    """
    Ring-sized groups (10–30) score highest.
    Very small (< 5) or very large (> 50) score lower.
    """
    if size < 5:
        return 0.0
    if RING_SIZE_MIN <= size <= RING_SIZE_MAX:
        return 1.0
    if size > RING_SIZE_MAX:
        # Still suspicious but might be a larger coordinated effort
        return 0.6
    # 5–9: somewhat suspicious
    return 0.4


def _device_concentration_score(unique_devices: int, size: int) -> float:
    """
    Few unique devices relative to group size = suspicious.
    If 30 accounts use 2 devices, that's very suspicious.
    If 30 accounts use 28 devices, that's normal.
    """
    if size <= 1:
        return 0.0
    ratio = unique_devices / size
    # ratio < 0.2 is very suspicious (many accounts, few devices)
    # ratio > 0.8 is normal (each account has its own device)
    if ratio <= 0.2:
        return 1.0
    if ratio >= 0.8:
        return 0.0
    return (0.8 - ratio) / 0.6


def _ip_concentration_score(unique_ips: int, size: int) -> float:
    """Same logic as device concentration but for IPs."""
    if size <= 1:
        return 0.0
    ratio = unique_ips / size
    if ratio <= 0.2:
        return 1.0
    if ratio >= 0.8:
        return 0.0
    return (0.8 - ratio) / 0.6


def _referral_density_score(referral_edges: int, size: int) -> float:
    """
    High referral density within a component is suspicious.
    Organic referrals are sparse; ring referrals form dense loops.
    """
    if size <= 1:
        return 0.0
    max_possible = size * (size - 1) / 2
    ratio = referral_edges / max_possible if max_possible > 0 else 0
    # 0.3+ referral density is very suspicious
    if ratio >= 0.3:
        return 1.0
    if ratio <= 0.05:
        return 0.0
    return (ratio - 0.05) / 0.25


def score_component(
    component: dict,
    temporal_result: dict,
) -> dict:
    """
    Score a single candidate component.

    Returns:
    - ring_score: 0.0–1.0 (higher = more likely a fraud ring)
    - sub_scores: breakdown of each signal's contribution
    - flagged: True if ring_score >= threshold
    """
    size = component["size"]

    sub_scores = {
        "density": _density_score(component["density"]),
        "size_suspect": _size_suspect_score(size),
        "device_concentration": _device_concentration_score(
            component["unique_devices"], size
        ),
        "ip_concentration": _ip_concentration_score(
            component["unique_ips"], size
        ),
        "referral_density": _referral_density_score(
            component["referral_edges"], size
        ),
        "temporal": temporal_result["score"],
    }

    # Weighted combination
    ring_score = sum(
        sub_scores[signal] * weight for signal, weight in WEIGHTS.items()
    )
    ring_score = round(ring_score, 4)

    return {
        "component_id": component["component_id"],
        "ring_score": ring_score,
        "sub_scores": sub_scores,
        "has_referral_cycle": component["has_referral_cycle"],
        "size": size,
        "members": component["members"],
    }


def detect_rings(
    data: dict[str, pd.DataFrame] = None,
    threshold: float = 0.45,
    data_dir: str = None,
) -> list[dict]:
    """
    Full detection pipeline:
    1. Load CSVs
    2. Build graph
    3. Find connected components
    4. Filter to candidates
    5. Score each candidate
    6. Return flagged rings sorted by score (descending)

    Args:
        data: pre-loaded CSV data (optional, loads from disk if None)
        threshold: minimum ring_score to flag (tune on dev split)
        data_dir: path to CSV directory (optional)
    """
    if data is None:
        data = load_csvs(data_dir)

    accounts_df = data["accounts"]

    # Build graph and find components
    G = build_graph(data)
    components = find_components(G)
    candidates = get_candidate_components(components)

    print(f"Found {len(components)} total components, {len(candidates)} candidates")

    # Score each candidate
    flagged = []
    for comp in candidates:
        temporal = compute_cluster_temporal(
            comp["members"], accounts_df, G, half_life=HALF_LIFE_MINUTES
        )
        result = score_component(comp, temporal)
        result["temporal"] = temporal
        result["structural"] = {
            "density": comp["density"],
            "unique_devices": comp["unique_devices"],
            "unique_ips": comp["unique_ips"],
            "referral_edges": comp["referral_edges"],
        }

        # Flag if score >= threshold AND temporal signal present,
        # OR if referral cycle detected (strong independent signal)
        meets_threshold = result["ring_score"] >= threshold
        meets_temporal = temporal["score"] >= MIN_TEMPORAL_SCORE
        has_cycle = result["has_referral_cycle"]

        if meets_threshold and (meets_temporal or has_cycle):
            flagged.append(result)

    # Sort by score descending
    flagged.sort(key=lambda x: x["ring_score"], reverse=True)

    print(f"Flagged {len(flagged)} rings (threshold={threshold})")
    return flagged
