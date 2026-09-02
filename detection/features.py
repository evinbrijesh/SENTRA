"""
Sentra — Feature Extraction

Builds a fixed-width feature vector (16 dimensions) for each connected
component in the account graph. These features are consumed by the ML
classifier for ring detection.

Separate from scoring.py to keep feature computation independent of
the model — allows testing features without a trained model and
swapping models without touching feature logic.
"""

import numpy as np
import pandas as pd
import networkx as nx

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
    # Referral degree-distribution features (adversarial hardening).
    # A farming star/tree has one high-out-degree root and many leaves; organic
    # referral graphs are shallow balanced trees. These survive proxy rotation
    # and cycle removal, unlike referral_density (which the N(N-1)/2
    # normalization hides stars behind). See docs/design/engineering-review-answers.md §2b.
    "max_out_degree",
    "referral_depth",
    "leaf_fraction",
]


def compute_referral_degree_features(members: list[str], graph) -> dict:
    """
    Compute referral degree-distribution features for a component's members.

    Uses the direction-preserving referral digraph (G.graph["referral_digraph"])
    restricted to the component's members. These features are the non-collapsing
    structural signal that survives proxy rotation and cycle removal — a farming
    star has one high-out-degree root and many leaves, whereas organic referral
    graphs are shallow balanced trees.

    Returns:
        dict with:
        - max_out_degree: highest out-degree among members (0 if no referrals)
        - referral_depth: longest directed path length (edges) in the subgraph
        - leaf_fraction: fraction of members with out-degree 0 (0.0 if empty)
    """
    member_set = set(members)
    digraph = graph.graph.get("referral_digraph", None)

    if digraph is None or not member_set:
        return {"max_out_degree": 0, "referral_depth": 0, "leaf_fraction": 0.0}

    sub = digraph.subgraph(member_set)
    n = max(len(member_set), 1)

    if sub.number_of_edges() == 0:
        return {"max_out_degree": 0, "referral_depth": 0, "leaf_fraction": 0.0}

    # Out-degree distribution over the component's members. Members absent from
    # the digraph (no referral edges at all) count as out-degree 0 — they are
    # leaves in the referral sense. NOTE: calling out_degree() on a node not in
    # the graph returns an empty OutDegreeView, not 0, so guard membership.
    out_degrees = {}
    for node in member_set:
        out_degrees[node] = sub.out_degree(node) if node in sub else 0
    max_out_degree = max(out_degrees.values())

    # Longest directed path length (edges) via topological sort. The referral
    # subgraph may contain cycles (rings), so guard against non-DAGs by falling
    # back to a bounded BFS from the highest-out-degree root.
    try:
        # nx.dag_longest_path_length raises NetworkXUnfeasible on cycles.
        referral_depth = nx.dag_longest_path_length(sub)
    except Exception:  # noqa: BLE001 — cycle present; use BFS depth from root
        root = max(out_degrees, key=out_degrees.get)
        referral_depth = _bfs_depth(sub, root)

    leaf_fraction = sum(1 for d in out_degrees.values() if d == 0) / n

    return {
        "max_out_degree": int(max_out_degree),
        "referral_depth": int(referral_depth),
        "leaf_fraction": round(float(leaf_fraction), 4),
    }


def _bfs_depth(digraph, root: str) -> int:
    """Bounded BFS depth (longest edge distance from root) for cyclic subgraphs."""
    from collections import deque

    depth = 0
    visited = {root}
    queue = deque([(root, 0)])
    while queue:
        node, d = queue.popleft()
        depth = max(depth, d)
        for nbr in digraph.successors(node):
            if nbr not in visited:
                visited.add(nbr)
                queue.append((nbr, d + 1))
    return depth


def extract_features_for_component(
    component: dict,
    accounts_df: pd.DataFrame,
    graph,
    half_life: float = 360.0,
    temporal: dict | None = None,
) -> dict:
    """
    Extract the 16-dim feature vector for a single component.

    Pass `temporal` (already computed by the caller, e.g. detect_rings) to
    avoid computing the temporal signal twice for the same component.

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

    # Temporal features (recompute only if the caller didn't supply them)
    if temporal is None:
        temporal = compute_cluster_temporal(
            component["members"], accounts_df, graph, half_life=half_life
        )

    # Referral degree-distribution features (adversarial hardening)
    degree = compute_referral_degree_features(component["members"], graph)

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
        degree["max_out_degree"],
        degree["referral_depth"],
        degree["leaf_fraction"],
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
        X: numpy array of shape (n_components, 16)
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
        X: feature matrix (n_components, 16)
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
