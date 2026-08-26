"""
Sentra — Graph Construction & Component Analysis

Builds a NetworkX graph from CSVs and identifies suspicious connected
components based on structural features: density, size, device/IP
concentration, referral cycles.

This module has ZERO dependency on api/ — it reads CSVs directly
and is unit-testable against ground_truth.json.
"""

import ast
import os
from pathlib import Path

import networkx as nx
import pandas as pd

DATA_DIR = Path(__file__).parent.parent / "data" / "raw"


def _parse_account_ids(value) -> list[str]:
    """Safely parse the account_ids cell (a stringified list) from CSV.

    Uses ast.literal_eval — never eval() — so a tampered CSV cannot
    execute arbitrary code. This matters because /ingest feeds
    external CSVs through this path.
    """
    if isinstance(value, str):
        parsed = ast.literal_eval(value)
        return [str(a) for a in parsed]
    return list(value)


def load_csvs(data_dir: str = None) -> dict[str, pd.DataFrame]:
    """Load all CSVs from data/raw/ into a dict of DataFrames."""
    if data_dir is None:
        data_dir = str(DATA_DIR)
    return {
        "accounts": pd.read_csv(os.path.join(data_dir, "accounts.csv")),
        "devices": pd.read_csv(os.path.join(data_dir, "devices.csv")),
        "ips": pd.read_csv(os.path.join(data_dir, "ips.csv")),
        "referrals": pd.read_csv(os.path.join(data_dir, "referrals.csv")),
        "transactions": pd.read_csv(os.path.join(data_dir, "transactions.csv")),
    }


def build_graph(data: dict[str, pd.DataFrame]) -> nx.Graph:
    """
    Build an undirected graph where:
    - Nodes = account_ids
    - Edges = shared device, shared IP, or referral link

    Edge attributes track WHY two accounts are connected (for explainability).

    Also stores a directed referral graph as G.graph["referral_digraph"]
    to preserve original referral direction (referrer → referred) — the
    undirected graph loses direction, which breaks cycle detection.
    """
    G = nx.Graph()
    referral_digraph = nx.DiGraph()

    accounts = data["accounts"]
    devices = data["devices"]
    ips = data["ips"]
    referrals = data["referrals"]

    # Add all account nodes
    for _, row in accounts.iterrows():
        G.add_node(
            row["account_id"],
            signup_time=row["signup_time"],
            kyc_status=row["kyc_status"],
        )

    # Edges from shared devices
    for _, row in devices.iterrows():
        account_ids = _parse_account_ids(row["account_ids"])
        for i in range(len(account_ids)):
            for j in range(i + 1, len(account_ids)):
                a1, a2 = account_ids[i], account_ids[j]
                if G.has_edge(a1, a2):
                    G[a1][a2]["reasons"].append("shared_device")
                    G[a1][a2]["device_id"] = row["device_id"]
                else:
                    G.add_edge(a1, a2, reasons=["shared_device"], device_id=row["device_id"])

    # Edges from shared IPs
    for _, row in ips.iterrows():
        account_ids = _parse_account_ids(row["account_ids"])
        for i in range(len(account_ids)):
            for j in range(i + 1, len(account_ids)):
                a1, a2 = account_ids[i], account_ids[j]
                if G.has_edge(a1, a2):
                    G[a1][a2]["reasons"].append("shared_ip")
                    G[a1][a2]["ip_address"] = row["ip_address"]
                else:
                    G.add_edge(a1, a2, reasons=["shared_ip"], ip_address=row["ip_address"])

    # Edges from referrals (store directed version for cycle detection)
    for _, row in referrals.iterrows():
        a1, a2 = row["referrer_id"], row["referred_id"]
        referral_digraph.add_edge(a1, a2)
        if G.has_edge(a1, a2):
            G[a1][a2]["reasons"].append("referral")
        else:
            G.add_edge(a1, a2, reasons=["referral"])

    G.graph["referral_digraph"] = referral_digraph
    return G


def find_components(G: nx.Graph) -> list[dict]:
    """
    Find all connected components and compute structural features for each.

    Returns a list of component dicts with:
    - component_id
    - size (number of accounts)
    - members (list of account_ids)
    - edge_count
    - density (edges / max possible edges)
    - unique_devices, unique_ips
    - shared_device_count, shared_ip_count
    - referral_edges
    - has_referral_cycle
    """
    components = []

    for idx, component_nodes in enumerate(nx.connected_components(G)):
        subgraph = G.subgraph(component_nodes)
        members = sorted(component_nodes)

        # Count edge types
        referral_edges = 0
        shared_device_edges = 0
        shared_ip_edges = 0
        devices_in_component = set()
        ips_in_component = set()

        for u, v, data in subgraph.edges(data=True):
            reasons = data.get("reasons", [])
            if "referral" in reasons:
                referral_edges += 1
            if "shared_device" in reasons:
                shared_device_edges += 1
                devices_in_component.add(data.get("device_id"))
            if "shared_ip" in reasons:
                shared_ip_edges += 1
                ips_in_component.add(data.get("ip_address"))

        # Check for referral cycles using the directed referral graph
        # (preserves original referrer→referred direction, unlike the
        # undirected subgraph which flips edges to u<v order)
        referral_digraph = G.graph.get("referral_digraph", nx.DiGraph())
        component_referral = referral_digraph.subgraph(component_nodes)
        has_cycle = (
            not nx.is_directed_acyclic_graph(component_referral)
            if component_referral.number_of_edges() > 0
            else False
        )

        # Compute density
        n = len(members)
        max_edges = n * (n - 1) / 2 if n > 1 else 1
        density = len(subgraph.edges()) / max_edges

        components.append({
            "component_id": idx,
            "size": n,
            "members": members,
            "edge_count": len(subgraph.edges()),
            "density": round(density, 4),
            "unique_devices": len(devices_in_component),
            "unique_ips": len(ips_in_component),
            "shared_device_edges": shared_device_edges,
            "shared_ip_edges": shared_ip_edges,
            "referral_edges": referral_edges,
            "has_referral_cycle": has_cycle,
        })

    return components


def get_candidate_components(
    components: list[dict],
    min_size: int = 5,
    min_density: float = 0.1,
    max_device_ratio: float = 0.5,
    max_ip_ratio: float = 0.5,
) -> list[dict]:
    """
    Filter components to only suspicious candidates.

    Heuristics:
    - Size >= min_size (a ring needs multiple accounts)
    - Density >= min_density (tightly connected)
    - Device concentration: unique_devices / size <= max_device_ratio
      (most accounts sharing few devices = suspicious)
    - IP concentration: unique_ips / size <= max_ip_ratio
    - OR has a referral cycle (organic referrals don't cycle)
    """
    candidates = []
    for comp in components:
        if comp["size"] < min_size:
            continue

        n = comp["size"]
        device_ratio = comp["unique_devices"] / n if n > 0 else 1
        ip_ratio = comp["unique_ips"] / n if n > 0 else 1

        has_concentration = device_ratio <= max_device_ratio or ip_ratio <= max_ip_ratio

        if (comp["density"] >= min_density and has_concentration) or comp["has_referral_cycle"]:
            candidates.append(comp)
    return candidates


def get_subgraph_json(G: nx.Graph, members: list[str]) -> dict:
    """
    Export a subgraph as nodes/edges JSON for Cytoscape.js visualization.

    Returns: {"nodes": [...], "edges": [...]}
    """
    subgraph = G.subgraph(members)

    nodes = []
    for node in subgraph.nodes(data=True):
        nodes.append({
            "data": {
                "id": node[0],
                "signup_time": node[1].get("signup_time", ""),
                "kyc_status": node[1].get("kyc_status", ""),
            }
        })

    edges = []
    for u, v, data in subgraph.edges(data=True):
        reasons = data.get("reasons", [])
        label = " + ".join(r.replace("_", " ") for r in reasons)
        edges.append({
            "data": {
                "source": u,
                "target": v,
                "label": label,
                "reasons": reasons,
            }
        })

    return {"nodes": nodes, "edges": edges}
