"""
Sentra — Explainability Engine

Turns a flagged ring's scores and structural features into a
plain-language explanation. This is the audit trail — every flagged
ring must answer "why was this flagged?" in terms a risk analyst
can act on.
"""

import pandas as pd

from detection.scoring import WEIGHTS


def explain_ring(
    flagged: dict,
    accounts_df: pd.DataFrame,
    graph=None,
) -> dict:
    """
    Generate a plain-language explanation for a flagged ring.

    Returns:
    - summary: one-sentence verdict
    - reasons: list of structured reason objects
    - risk_factors: ranked list of what contributed most to the score
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

    # ── Risk factors (ranked by sub_score contribution) ─────────
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

    return {
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
