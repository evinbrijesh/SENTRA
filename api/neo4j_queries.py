"""
Neo4j graph queries for the API.

The relationship layer (account-device, account-ip, referral edges) lives in
Neo4j. These helpers query it to serve the subgraph visualization and shared-
entity panels. Every function is best-effort: routes fall back to the CSV-backed
graph_queries when Neo4j is unreachable, so the API still works during demos
before the graph DB is up.
"""

import logging

log = logging.getLogger("api.neo4j")

_REASON_OF = {
    "USES_DEVICE": "shared_device",
    "CONNECTS_VIA_IP": "shared_ip",
    "REFERRED": "referral",
    "HAS_PAYMENT_METHOD": "shared_payment_method",
}


def _run(query: str, **params) -> list[dict]:
    from api.db import get_neo4j_driver
    driver = get_neo4j_driver()
    with driver.session() as session:
        result = session.run(query, **params)
        return [dict(rec) for rec in result]


def get_subgraph(members: list[str]) -> dict:
    """Return Cytoscape nodes/edges for a ring's member accounts.

    Shape matches detection/graph_queries.get_subgraph_json so the dashboard
    consumes it unchanged:
      { nodes: [{data:{id, signup_time, kyc_status}}],
        edges: [{data:{source, target, label, reasons}}] }
    """
    members = [str(m) for m in members]

    node_rows = _run(
        "MATCH (a:Account) WHERE a.account_id IN $members "
        "RETURN a.account_id AS id, a.signup_time AS signup_time, a.kyc_status AS kyc_status",
        members=members,
    )
    nodes = [
        {"data": {
            "id": r["id"],
            "signup_time": r.get("signup_time") or "",
            "kyc_status": r.get("kyc_status") or "",
        }}
        for r in node_rows
    ]

    edge_rows = _run(
        "MATCH (a:Account)-[r]-(b:Account) "
        "WHERE a.account_id IN $members AND b.account_id IN $members AND a.account_id < b.account_id "
        "RETURN a.account_id AS s, b.account_id AS t, collect(DISTINCT type(r)) AS rels",
        members=members,
    )
    edges = []
    for r in edge_rows:
        reasons = []
        for rel in r["rels"]:
            reason = _REASON_OF.get(rel)
            if reason and reason not in reasons:
                reasons.append(reason)
        if not reasons:
            continue
        edges.append({
            "data": {
                "source": r["s"],
                "target": r["t"],
                "label": " + ".join(x.replace("_", " ") for x in reasons),
                "reasons": reasons,
            }
        })

    return {"nodes": nodes, "edges": edges}


def get_shared_entities(members: list[str]) -> dict:
    """Return shared devices / IPs / payment methods / referral cycle for a ring."""
    members = [str(m) for m in members]
    out = {"devices": [], "ips": [], "payment_methods": [], "has_referral_cycle": False}

    dev_rows = _run(
        "MATCH (a:Account)-[:USES_DEVICE]->(d:Device) WHERE a.account_id IN $members "
        "RETURN d.device_id AS value, count(a) AS accounts ORDER BY accounts DESC LIMIT 5",
        members=members,
    )
    out["devices"] = [{"id": r["value"], "accounts": r["accounts"]} for r in dev_rows]

    ip_rows = _run(
        "MATCH (a:Account)-[:CONNECTS_VIA_IP]->(i:IP) WHERE a.account_id IN $members "
        "RETURN i.ip_address AS value, count(a) AS accounts ORDER BY accounts DESC LIMIT 5",
        members=members,
    )
    out["ips"] = [{"id": r["value"], "accounts": r["accounts"]} for r in ip_rows]

    pm_rows = _run(
        "MATCH (a:Account)-[:HAS_PAYMENT_METHOD]->(pm:PaymentMethod) "
        "WHERE a.account_id IN $members "
        "RETURN pm.id AS value, pm.type AS type, count(a) AS accounts ORDER BY accounts DESC LIMIT 5",
        members=members,
    )
    out["payment_methods"] = [{"id": r["value"], "type": r.get("type"), "accounts": r["accounts"]} for r in pm_rows]

    cyc = _run(
        "MATCH (a:Account)-[:REFERRED]->(b:Account) "
        "WHERE a.account_id IN $members AND b.account_id IN $members "
        "RETURN a.account_id AS s, b.account_id AS t",
        members=members,
    )
    out["has_referral_cycle"] = _has_cycle([(r["s"], r["t"]) for r in cyc])

    return out


def _has_cycle(edges: list[tuple]) -> bool:
    """Detect a directed cycle in a small edge list (members-only referral graph)."""
    if not edges:
        return False
    adj = {}
    nodes = set()
    for s, t in edges:
        adj.setdefault(s, []).append(t)
        nodes.add(s)
        nodes.add(t)

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in nodes}

    def visit(u):
        color[u] = GRAY
        for v in adj.get(u, []):
            if color.get(v, WHITE) == GRAY:
                return True
            if color.get(v, WHITE) == WHITE and visit(v):
                return True
        color[u] = BLACK
        return False

    for n in nodes:
        if color[n] == WHITE and visit(n):
            return True
    return False


def structural_counts(members: list[str]) -> dict:
    """Cheap structural counts straight from the relationship DB."""
    members = [str(m) for m in members]
    try:
        dev = _count("USES_DEVICE", members)
        ip = _count("CONNECTS_VIA_IP", members)
        return {
            "unique_devices": dev,
            "unique_ips": ip,
        }
    except Exception as e:  # noqa: BLE001
        log.warning("structural_counts neo4j query failed: %s", e)
        return {}


def _count(rel: str, members: list[str]) -> int:
    rows = _run(
        "MATCH (a:Account)-[:" + rel + "]->(x) WHERE a.account_id IN $members "
        "RETURN count(DISTINCT x) AS n",
        members=members,
    )
    return int(rows[0]["n"]) if rows and rows[0] and rows[0].get("n") is not None else 0
