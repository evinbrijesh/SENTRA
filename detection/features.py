"""
Sentra — Feature Extraction

Builds a fixed-width feature vector (13 dimensions) for each connected
component in the account graph. These features are consumed by the ML
classifier for ring detection.

Separate from scoring.py to keep feature computation independent of
the model — allows testing features without a trained model and
swapping models without touching feature logic.
"""

import numpy as np
import pandas as pd

from detection.graph_queries import build_graph, find_components, load_csvs
from detection.temporal import compute_cluster_temporal

# Feature names in order — used for model training and SHAP explanations
FEATURE_NAMES = [
    "size",
    "density",
    "unique_devices",
    "unique_ips",
    "device_concentration",
    "ip_concentration",
    "shared_device_edges",
    "shared_ip_edges",
    "referral_edges",
    "referral_density",
    "has_referral_cycle",
    "temporal_score",
    "burst_minutes",
]


def extract_features_for_component(
    component: dict,
    accounts_df: pd.DataFrame,
    graph,
    half_life: float = 360.0,
) -> dict:
    """
    Extract the 13-dim feature vector for a single component.

    Returns:
        dict with 'features' (list of floats), 'feature_names' (list of str),
        and 'component_id' for traceability.
    """
    size = component["size"]
    n = max(size, 1)

    # Derived features
    device_concentration = component["unique_devices"] / n
    ip_concentration = component["unique_ips"] / n
    max_possible = size * (size - 1) / 2 if size > 1 else 1
    referral_density = component["referral_edges"] / max_possible

    # Temporal features
    temporal = compute_cluster_temporal(
        component["members"], accounts_df, graph, half_life=half_life
    )

    features = [
        size,
        component["density"],
        component["unique_devices"],
        component["unique_ips"],
        device_concentration,
        ip_concentration,
        component["shared_device_edges"],
        component["shared_ip_edges"],
        component["referral_edges"],
        referral_density,
        1.0 if component["has_referral_cycle"] else 0.0,
        temporal["score"],
        temporal["burst_minutes"],
    ]

    return {
        "component_id": component["component_id"],
        "features": features,
        "feature_names": FEATURE_NAMES,
        "temporal": temporal,
    }


def extract_features_for_components(
    components: list[dict],
    accounts_df: pd.DataFrame,
    graph,
    half_life: float = 360.0,
) -> tuple[np.ndarray, list[str], list[dict]]:
    """
    Extract features for a list of components.

    Returns:
        X: numpy array of shape (n_components, 13)
        component_ids: list of component IDs for traceability
        temporal_results: list of temporal dicts for each component
    """
    all_features = []
    component_ids = []
    temporal_results = []

    for comp in components:
        result = extract_features_for_component(comp, accounts_df, graph, half_life)
        all_features.append(result["features"])
        component_ids.append(result["component_id"])
        temporal_results.append(result["temporal"])

    X = np.array(all_features, dtype=np.float64)
    return X, component_ids, temporal_results


def extract_features_from_csvs(
    data_dir: str = None,
    half_life: float = 360.0,
) -> tuple[np.ndarray, list[str], list[dict], list[dict], pd.DataFrame]:
    """
    End-to-end feature extraction from CSVs.

    Returns:
        X: feature matrix (n_components, 13)
        component_ids: component ID per row
        temporal_results: temporal dict per component
        components: full component dicts (for traceability)
        accounts_df: accounts DataFrame
    """
    data = load_csvs(data_dir)
    accounts_df = data["accounts"]
    G = build_graph(data)
    components = find_components(G)

    X, component_ids, temporal_results = extract_features_for_components(
        components, accounts_df, G, half_life
    )

    return X, component_ids, temporal_results, components, accounts_df
