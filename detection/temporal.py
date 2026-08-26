"""
Sentra — Temporal Signal: Signup Time Clustering

Measures how tightly clustered signup times are within a candidate
component. A ring burst-signups in minutes; normal accounts spread
out over days/weeks.

Two modes:
1. compute_temporal_score — scores all members (simple case)
2. compute_cluster_temporal — scores only accounts sharing the dominant
   device/IP (handles contaminated components where normal accounts
   got pulled in through shared edges)
"""

from collections import Counter
from datetime import datetime

import numpy as np
import pandas as pd


def compute_temporal_score(
    members: list[str],
    accounts_df: pd.DataFrame,
    full_window_days: int = 90,
    half_life: float = 360.0,
) -> dict:
    """
    Score how clustered signup times are for a set of accounts.

    Returns:
    - score: 0.0–1.0 (higher = more clustered)
    - burst_start: earliest signup in the component
    - burst_end: latest signup in the component
    - burst_minutes: duration of the signup window in minutes
    - mean_signup: average signup time (for reference)
    """
    member_df = accounts_df[accounts_df["account_id"].isin(members)].copy()
    member_df["signup_dt"] = pd.to_datetime(member_df["signup_time"])

    if len(member_df) < 2:
        return {
            "score": 0.0,
            "burst_start": None,
            "burst_end": None,
            "burst_minutes": 0,
            "mean_signup": None,
        }

    signup_times = member_df["signup_dt"].sort_values()
    burst_start = signup_times.iloc[0]
    burst_end = signup_times.iloc[-1]
    burst_minutes = (burst_end - burst_start).total_seconds() / 60

    # Score: exponential decay with configurable half-life
    score = np.exp(-np.log(2) * burst_minutes / half_life)
    score = max(0.0, min(1.0, float(score)))

    return {
        "score": round(score, 4),
        "burst_start": burst_start.strftime("%Y-%m-%d %H:%M:%S"),
        "burst_end": burst_end.strftime("%Y-%m-%d %H:%M:%S"),
        "burst_minutes": round(burst_minutes, 1),
        "mean_signup": signup_times.mean().strftime("%Y-%m-%d %H:%M:%S"),
    }


def compute_cluster_temporal(
    members: list[str],
    accounts_df: pd.DataFrame,
    graph,
    full_window_days: int = 90,
    half_life: float = 360.0,
) -> dict:
    """
    Compute temporal score for the dominant device/IP cluster within a component.

    Components can be contaminated — a ring connected to normal accounts via
    shared device/IP edges pulls normal accounts into the same component.
    This function finds the densest cluster (accounts sharing the most common
    device or IP) and scores only those accounts' signup times.

    Returns same format as compute_temporal_score, plus:
    - cluster_size: how many accounts are in the dominant cluster
    - cluster_source: "device:<id>" or "ip:<addr>" indicating what formed the cluster
    """
    member_df = accounts_df[accounts_df["account_id"].isin(members)].copy()
    if len(member_df) < 2:
        return compute_temporal_score(members, accounts_df, full_window_days, half_life)

    # Find dominant device: most component members using the same device
    device_counts = Counter(member_df["device_id"].dropna())
    ip_counts = Counter(member_df["ip_address"].dropna())

    best_cluster = None
    best_source = None
    best_count = 0

    if device_counts:
        top_device, top_device_count = device_counts.most_common(1)[0]
        if top_device_count > best_count:
            best_count = top_device_count
            best_source = f"device:{top_device}"
            best_cluster = member_df[member_df["device_id"] == top_device]["account_id"].tolist()

    if ip_counts:
        top_ip, top_ip_count = ip_counts.most_common(1)[0]
        if top_ip_count > best_count:
            best_count = top_ip_count
            best_source = f"ip:{top_ip}"
            best_cluster = member_df[member_df["ip_address"] == top_ip]["account_id"].tolist()

    if best_cluster is None or len(best_cluster) < 2:
        return compute_temporal_score(members, accounts_df, full_window_days, half_life)

    result = compute_temporal_score(best_cluster, accounts_df, full_window_days, half_life)
    result["cluster_size"] = len(best_cluster)
    result["cluster_source"] = best_source
    return result
