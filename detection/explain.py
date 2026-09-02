"""
Sentra — Explainability Engine

Turns a flagged ring's scores and structural features into a
plain-language explanation. This is the audit trail — every flagged
ring must answer "why was this flagged?" in terms a risk analyst
can act on.

Now includes SHAP (SHapley Additive exPlanations) for ML model
explainability — shows which features drove the model's decision
and by how much for each individual prediction.
"""

import pandas as pd
import numpy as np

from detection.scoring import WEIGHTS
from detection.features import FEATURE_NAMES, extract_features_for_component
from detection.graph_queries import build_graph, load_csvs

# SHAP is optional - handle gracefully if not installed
try:
    import shap
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False

# Module-level explainer cache. Deserializing the model from disk costs ~150ms;
# without this cache we paid that once PER RING (the profiled hot path spent
# ~50% of a detection run re-pickling the same RandomForest).
_SHAP_EXPLAINER = None
_SHAP_EXPLAINER_LOADED = False


def _get_shap_explainer():
    """
    Get (or create once) the SHAP TreeExplainer for the ML model.
    Uses the model's training data as background if available.
    """
    global _SHAP_EXPLAINER, _SHAP_EXPLAINER_LOADED
    if _SHAP_EXPLAINER_LOADED:
        return _SHAP_EXPLAINER

    if not HAS_SHAP:
        _SHAP_EXPLAINER = None
        _SHAP_EXPLAINER_LOADED = True
        return None

    import joblib
    from pathlib import Path

    MODEL_DIR = Path(__file__).parent.parent / "detection" / "model"
    MODEL_PATH = MODEL_DIR / "ring_classifier.joblib"

    if not MODEL_PATH.exists():
        _SHAP_EXPLAINER = None
        _SHAP_EXPLAINER_LOADED = True
        return None

    model = joblib.load(MODEL_PATH)

    # Create TreeExplainer - for RandomForest/XGBoost
    # Use feature_perturbation='tree_path_dependent' for speed (no background data needed)
    _SHAP_EXPLAINER = shap.TreeExplainer(model, feature_perturbation='tree_path_dependent')
    _SHAP_EXPLAINER_LOADED = True
    return _SHAP_EXPLAINER


def _compute_shap_values(component: dict, accounts_df: pd.DataFrame, graph) -> dict | None:
    """
    Compute SHAP values for a single component's features.
    
    Returns dict with feature names as keys and SHAP values as values,
    or None if SHAP is not available.
    """
    if not HAS_SHAP:
        return None
    
    explainer = _get_shap_explainer()
    if explainer is None:
        return None
    
    # Extract features for this component
    result = extract_features_for_component(component, accounts_df, graph)
    features = np.array(result["features"]).reshape(1, -1)  # shape (1, 13)
    
    # Compute SHAP values - returns (n_samples, n_features, n_classes) for binary
    shap_values = explainer.shap_values(features)
    
    # For binary classification: shap_values is list of [class_0, class_1] arrays
    # Each has shape (1, 13)
    if isinstance(shap_values, list) and len(shap_values) == 2:
        # Class 1 (ring) SHAP values
        sv = shap_values[1][0]  # shape (13,)
    else:
        # Single array case: shape (1, 13, 2) -> take class 1
        sv = shap_values[0, :, 1]
    
    # Return as dict
    return dict(zip(FEATURE_NAMES, [float(v) for v in sv]))


def explain_ring(
    flagged: dict,
    accounts_df: pd.DataFrame,
    graph=None,
    include_shap: bool = True,
) -> dict:
    """
    Generate a plain-language explanation for a flagged ring.

    include_shap=False skips SHAP computation — use it for rings whose
    explanations are never rendered (e.g. the clean bucket), since SHAP is
    the most expensive part of explanation.

    Returns:
    - summary: one-sentence verdict
    - reasons: list of structured reason objects
    - risk_factors: ranked list of what contributed most to the score (rule-based)
    - shap_values: SHAP values showing ML feature contributions (if available)
    - member_summary: stats about the ring members
    """
    members = flagged["members"]
    size = flagged["size"]
    temporal = flagged.get("temporal", {})
    structural = flagged.get("structural", {})
    sub_scores = flagged.get("sub_scores", {})

    member_df = accounts_df[accounts_df["account_id"].isin(members)]

    # ── Build reasons list ──────────────────────────────────────
    reasons = []

    # 1. Shared device
    if structural.get("unique_devices", 0) > 0:
        device_ratio = structural["unique_devices"] / size
        if device_ratio < 0.5:
            reasons.append({
                "type": "shared_device",
                "detail": (
                    f"{size} accounts share just {structural['unique_devices']} "
                    f"device(s) — {device_ratio:.0%} device concentration"
                ),
                "severity": "high" if device_ratio < 0.2 else "medium",
            })

    # 2. Shared IP
    if structural.get("unique_ips", 0) > 0:
        ip_ratio = structural["unique_ips"] / size
        if ip_ratio < 0.5:
            reasons.append({
                "type": "shared_ip",
                "detail": (
                    f"{size} accounts connect from just {structural['unique_ips']} "
                    f"IP address(es) — {ip_ratio:.0%} IP concentration"
                ),
                "severity": "high" if ip_ratio < 0.2 else "medium",
            })

    # 3. Signup burst
    burst_minutes = temporal.get("burst_minutes", 0)
    if burst_minutes > 0:
        if burst_minutes < 60:
            reasons.append({
                "type": "signup_burst",
                "detail": (
                    f"All {size} accounts signed up within "
                    f"{burst_minutes:.0f} minutes "
                    f"({temporal['burst_start']} to {temporal['burst_end']})"
                ),
                "severity": "high",
            })
        elif burst_minutes < 360:
            reasons.append({
                "type": "signup_burst",
                "detail": (
                    f"All {size} accounts signed up within "
                    f"{burst_minutes:.0f} minutes "
                    f"({temporal['burst_start']} to {temporal['burst_end']})"
                ),
                "severity": "medium",
            })

    # 4. Referral cycle
    if flagged.get("has_referral_cycle"):
        reasons.append({
            "type": "referral_cycle",
            "detail": (
                f"Closed-loop referral chain detected within the cluster — "
                f"organic referral trees don't cycle back"
            ),
            "severity": "high",
        })

    # 5. Referral density
    if structural.get("referral_edges", 0) > 0:
        max_possible = size * (size - 1) / 2
        ref_density = structural["referral_edges"] / max_possible if max_possible > 0 else 0
        if ref_density > 0.15:
            reasons.append({
                "type": "referral_density",
                "detail": (
                    f"{structural['referral_edges']} referral edges within "
                    f"{size} accounts ({ref_density:.0%} density) — "
                    f"far above organic referral patterns"
                ),
                "severity": "high" if ref_density > 0.3 else "medium",
            })

    # ── Risk factors (ranked by rule-based sub_score contribution) ─────────
    risk_factors = []
    for signal, weight in sorted(
        WEIGHTS.items(), key=lambda x: x[1] * sub_scores.get(x[0], 0), reverse=True
    ):
        contribution = sub_scores.get(signal, 0) * weight
        if contribution > 0:
            risk_factors.append({
                "factor": signal,
                "score": sub_scores.get(signal, 0),
                "weight": weight,
                "contribution": round(contribution, 4),
            })

    # ── SHAP values (ML model explainability) ────────────────────
    shap_values = None
    if graph is not None and HAS_SHAP and include_shap:
        # Reconstruct the component dict from the real structural and
        # sub_score data so SHAP sees the same features the model scored.
        density_sub = sub_scores.get("density", 0)
        density_weight = WEIGHTS.get("density", 1) or 1
        shap_values = _compute_shap_values(
            {
                "component_id": flagged.get("component_id"),
                "size": size,
                "density": density_sub / density_weight,
                "unique_devices": structural.get("unique_devices", 0),
                "unique_ips": structural.get("unique_ips", 0),
                "shared_device_edges": structural.get("shared_device_edges", 0),
                "shared_ip_edges": structural.get("shared_ip_edges", 0),
                "referral_edges": structural.get("referral_edges", 0),
                "has_referral_cycle": flagged.get("has_referral_cycle", False),
                "members": members,
            },
            accounts_df,
            graph,
        )

    # ── Summary ─────────────────────────────────────────────────
    score = flagged["ring_score"]
    if score >= 0.7:
        confidence = "high"
    elif score >= 0.5:
        confidence = "medium"
    else:
        confidence = "low"

    summary = (
        f"Cluster of {size} accounts flagged with {confidence} confidence "
        f"(score: {score:.2f}). "
    )
    if reasons:
        summary += "Primary indicators: " + "; ".join(
            r["detail"].split(" — ")[0] for r in reasons[:3]
        ) + "."

    # ── Member summary ──────────────────────────────────────────
    kyc_dist = member_df["kyc_status"].value_counts().to_dict() if len(member_df) > 0 else {}

    output = {
        "ring_id": flagged.get("component_id"),
        "ring_score": score,
        "confidence": confidence,
        "summary": summary,
        "reasons": reasons,
        "risk_factors": risk_factors,
        "member_summary": {
            "size": size,
            "kyc_distribution": kyc_dist,
            "signup_window": f"{temporal.get('burst_start', 'N/A')} to {temporal.get('burst_end', 'N/A')}",
            "burst_minutes": burst_minutes,
        },
    }
    
    if shap_values is not None:
        output["shap_values"] = shap_values
    
    return output
