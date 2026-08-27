"""
Sentra — Ring Scoring Engine

Combines structural, temporal, and referral-cycle signals into a
single ring score (0.0–1.0).

Primary approach: loads a trained ML model (RandomForest/XGBoost)
and predicts on component-level features. The model is trained by
detection/train.py and saved to detection/model/ring_classifier.joblib.

Rule-based scoring is retained as a baseline for comparison. If the
ML model underperforms the baseline, the baseline becomes primary.

Feature extraction is handled by detection/features.py (13-dim vector).
Explainability is handled by detection/explain.py (feature importance + SHAP).
"""

import joblib
import os
from pathlib import Path

import numpy as np
import pandas as pd

from detection.graph_queries import build_graph, find_components, get_candidate_components, load_csvs
from detection.temporal import compute_cluster_temporal

# ── Model path ──────────────────────────────────────────────
MODEL_DIR = Path(__file__).parent.parent / "detection" / "model"
MODEL_PATH = MODEL_DIR / "ring_classifier.joblib"

# Load trained model at import time
_ml_model = None
_ml_model_loaded = False

# Decision threshold (selected on a validation slice during training).
# Falls back to 0.45 if no threshold artifact is present.
_THRESHOLD_PATH = MODEL_DIR / "threshold.json"
DEFAULT_THRESHOLD = 0.45
try:
    if _THRESHOLD_PATH.exists():
        with open(_THRESHOLD_PATH) as _tf:
            DEFAULT_THRESHOLD = float(json.load(_tf)["threshold"])
except Exception:
    DEFAULT_THRESHOLD = 0.45


def _get_ml_model():
    """Load the ML model if not already loaded."""
    global _ml_model, _ml_model_loaded
    if not _ml_model_loaded:
        if MODEL_PATH.exists():
            _ml_model = joblib.load(MODEL_PATH)
            _ml_model_loaded = True
        else:
            _ml_model = None
            _ml_model_loaded = True
    return _ml_model

# ── Scoring weights (tune these on the dev split) ──────────────
# Each signal contributes a sub-score 0–1, weighted and combined.
# Used for rule-based baseline and as auxiliary signals in ML feature vector.
WEIGHTS = {
    "density": 0.25,       # how tightly connected the component is
    "size_suspect": 0.15,  # ring-sized (10–30) is more suspicious
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

# Review band: candidates with scores in [REVIEW_SCORE_MIN, threshold)
# get routed to human review instead of being silently passed/failed.
# This catches borderline cases (e.g., subtler rings with weaker signals)
# without lowering the auto-flag threshold and risking false positives.
REVIEW_SCORE_MIN = 0.25
REVIEW_TEMPORAL_MIN = 0.15  # lower temporal bar for review vs auto-flag

# Exponential decay half-life for temporal scoring (minutes)
HALF_LIFE_MINUTES = 360.0


def _density_score(density: float) -> float:
    """
    Map density (0–1) to a suspicion score.
    Dense subgraphs are suspicious; sparse ones are normal.
    """
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
        return 0.6
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
    if ratio >= 0.3:
        return 1.0
    if ratio <= 0.05:
        return 0.0
    return (ratio - 0.05) / 0.25


def score_component_rule_based(
    component: dict,
    temporal_result: dict,
) -> dict:
    """
    Rule-based scoring using weighted combination of sub-scores.

    This is the original scoring logic, retained for baseline comparison
    and as a fallback when the ML model is not available.

    Returns:
    - ring_score: 0.0–1.0 (higher = more likely a fraud ring)
    - sub_scores: breakdown of each signal's contribution
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


def _extract_component_features(
    component: dict,
    accounts_df: pd.DataFrame,
    graph,
) -> np.ndarray:
    """
    Extract the 13-dim feature vector for a single component.

    Same order as FEATURE_NAMES in detection/features.py.
    """
    from detection.features import FEATURE_NAMES, extract_features_for_component

    result = extract_features_for_component(component, accounts_df, graph)
    return np.array(result["features"], dtype=np.float64)


def predict_ml_score(
    component: dict,
    accounts_df: pd.DataFrame,
    graph,
    model=None,
) -> float:
    """
    Get ring probability from the ML model for a single component.

    Returns probability of class 1 (ring) 0.0–1.0.
    Falls back to rule-based score if model not available.
    """
    if model is None:
        model = _get_ml_model()

    if model is None:
        # Model not trained; fall back to rule-based
        from detection.scoring import score_component_rule_based
        result = score_component_rule_based(component, {"score": 0.0})
        return result["ring_score"]

    # Extract features and predict
    features = _extract_component_features(component, accounts_df, graph)
    proba = model.predict_proba([features])[0, 1]
    return round(float(proba), 4)


def detect_rings(
    data: dict[str, pd.DataFrame] = None,
    threshold: float = 0.45,
    data_dir: str = None,
    use_ml: bool = True,
) -> dict:
    """
    Full detection pipeline:

    1. Load CSVs
    2. Build graph
    3. Find connected components
    4. Filter to candidates
    5. Score each candidate (ML or rule-based)
    6. Classify into flagged / needs_review / clean

    Returns:
    - flagged: list of dicts, auto-flagged rings (score >= threshold)
    - needs_review: list of dicts, borderline candidates for human review
    - clean: list of dicts, candidates that passed all filters

    The review bucket catches cases where structural signals are present
    but temporal or referral signals are borderline.

    If use_ml=True (default), uses the trained ML model for scoring.
    If use_ml=False, uses the rule-based baseline.
    """
    if data is None:
        data = load_csvs(data_dir)

    accounts_df = data["accounts"]

    # Build graph and find components
    G = build_graph(data)
    components = find_components(G)
    candidates = get_candidate_components(components)

    print(f"Found {len(components)} total components, {len(candidates)} candidates")

    # Load ML model if using ML scoring
    ml_model = None
    if use_ml:
        ml_model = _get_ml_model()

    # Score each candidate
    flagged = []
    needs_review = []
    clean = []

    for comp in candidates:
        temporal = compute_cluster_temporal(
            comp["members"], accounts_df, G, half_life=HALF_LIFE_MINUTES
        )

        if use_ml and ml_model is not None:
            # Use ML model for scoring
            ring_score = predict_ml_score(comp, accounts_df, G, ml_model)
            result = {
                "component_id": comp["component_id"],
                "ring_score": ring_score,
                "ml_probability": ring_score,
                "has_referral_cycle": comp["has_referral_cycle"],
                "size": comp["size"],
                "members": comp["members"],
                "sub_scores": {
                    "density": _density_score(comp["density"]),
                    "size_suspect": _size_suspect_score(comp["size"]),
                    "device_concentration": _device_concentration_score(
                        comp["unique_devices"], comp["size"]
                    ),
                    "ip_concentration": _ip_concentration_score(
                        comp["unique_ips"], comp["size"]
                    ),
                    "referral_density": _referral_density_score(
                        comp["referral_edges"], comp["size"]
                    ),
                    "temporal": temporal["score"],
                },
            }
        else:
            # Use rule-based scoring
            result = score_component_rule_based(comp, temporal)

        result["temporal"] = temporal

        meets_threshold = result["ring_score"] >= threshold
        meets_temporal = temporal["score"] >= MIN_TEMPORAL_SCORE
        has_cycle = result["has_referral_cycle"]

        meets_review_min = result["ring_score"] >= REVIEW_SCORE_MIN
        meets_review_temporal = temporal["score"] >= REVIEW_TEMPORAL_MIN

        if use_ml and ml_model is not None:
            # ML mode: the model probability already blends all signals
            # (structure, temporal, referral). Flagging solely on the learned
            # threshold avoids discarding subtle rings that lack a tight burst
            # or referral cycle. The rule-based gate below is NOT applied here
            # because it would silently drop hard rings (the dominant FP-cost
            # failure mode we measured during tuning).
            if meets_threshold:
                result["status"] = "flagged"
                flagged.append(result)
            elif meets_review_min:
                result["status"] = "needs_review"
                needs_review.append(result)
            else:
                result["status"] = "clean"
                clean.append(result)
        else:
            # Rule-based mode: keep the temporal/cycle gate to suppress false
            # positives from normal shared-device families (shared wifi etc.).
            if meets_threshold and (meets_temporal or has_cycle):
                result["status"] = "flagged"
                flagged.append(result)
            elif meets_review_min and (meets_review_temporal or has_cycle):
                result["status"] = "needs_review"
                needs_review.append(result)
            else:
                result["status"] = "clean"
                clean.append(result)

    # Sort each bucket by score descending
    flagged.sort(key=lambda x: x["ring_score"], reverse=True)
    needs_review.sort(key=lambda x: x["ring_score"], reverse=True)

    print(f"Flagged: {len(flagged)}, Needs review: {len(needs_review)}, Clean: {len(clean)}")
    return {
        "flagged": flagged,
        "needs_review": needs_review,
        "clean": clean,
    }


if __name__ == "__main__":
    import json
    import argparse
    from detection.explain import explain_ring

    parser = argparse.ArgumentParser(description="Sentra ring detection pipeline")
    parser.add_argument("--data-dir", default="data/raw/", help="Path to CSV directory")
    parser.add_argument("--output", default="data/output/flagged_rings.json", help="Output JSON path")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD, help="Ring score threshold")
    parser.add_argument("--use-ml", action="store_true", default=True, help="Use ML model (default)")
    parser.add_argument("--use-rule-based", dest="use_ml", action="store_false",
                        help="Use rule-based scoring instead of ML")
    args = parser.parse_args()

    print(f"Loading data from {args.data_dir}")
    data = load_csvs(args.data_dir)
    accounts_df = data["accounts"]

    results = detect_rings(data=data, threshold=args.threshold, use_ml=args.use_ml)

    # Build explained output for all three categories
    output = {}
    for category in ["flagged", "needs_review", "clean"]:
        explained = []
        for ring in results[category]:
            exp = explain_ring(ring, accounts_df, graph=build_graph(data))
            exp["members"] = ring["members"]
            exp["status"] = ring["status"]
            explained.append(exp)
        output[category] = explained

    from pathlib import Path
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nWrote results to {output_path}")
    for category, rings in output.items():
        print(f"  {category}: {len(rings)}")
        for r in rings:
            score = r.get("ring_score", 0)
            conf = r.get("confidence", "n/a")
            size = r.get("member_summary", {}).get("size", 0)
            has_shap = "shap_values" in r
            print(f"    {r['ring_id']}: score={score:.2f} confidence={conf} members={size} shap={'yes' if has_shap else 'no'}")