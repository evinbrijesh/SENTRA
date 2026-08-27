"""
Loader — the single ingestion path into Postgres + Neo4j.

Used for the initial dataset AND every later batch re-run via /ingest. It must
be idempotent (safe to run twice) so re-runs never double-insert.

Postgres holds row-level truth:
  - accounts           (account_id, signup_time, kyc_status)
  - transactions       (transaction_id, account_id, amount, timestamp)
  - payment_methods    (account_id, payment_method_type, payment_method_id)

Neo4j holds the relationship layer:
  - (Account)-[:USES_DEVICE]->(Device)
  - (Account)-[:CONNECTS_VIA_IP]->(IP)
  - (Account)-[:REFERRED]->(Account)   (referral edges, direction-preserving)
  - (Account)-[:HAS_PAYMENT_METHOD]->(PaymentMethod)

All Neo4j writes use Cypher MERGE (idempotent). Postgres writes use
INSERT ... ON CONFLICT DO NOTHING (idempotent).

Lazy-imports the db drivers so this module stays importable for unit tests
of its pure helpers even when psycopg2/neo4j are not installed locally.
"""

import argparse
import ast
import logging
import os
import time
from pathlib import Path

import pandas as pd

log = logging.getLogger("loader")


# ── Config (mirrors .env.example, overridable via env) ────────────────────
def pg_config() -> dict:
    return {
        "host": os.getenv("POSTGRES_HOST", "localhost"),
        "port": int(os.getenv("POSTGRES_PORT", "5432")),
        "dbname": os.getenv("POSTGRES_DB", "sentra"),
        "user": os.getenv("POSTGRES_USER", "sentra"),
        "password": os.getenv("POSTGRES_PASSWORD", "changeme"),
    }


def neo4j_config() -> dict:
    return {
        "uri": os.getenv("NEO4J_URI", "bolt://localhost:7687"),
        "user": os.getenv("NEO4J_USER", "neo4j"),
        "password": os.getenv("NEO4J_PASSWORD", "changeme"),
    }


def _parse_account_ids(value) -> list[str]:
    """Safely parse the account_ids cell (stringified list) from CSV."""
    if isinstance(value, str):
        parsed = ast.literal_eval(value)
        return [str(a) for a in parsed]
    return [str(a) for a in value]


def load_csvs(data_dir: str) -> dict[str, pd.DataFrame]:
    """Read all CSV files for a batch into a dict of DataFrames."""
    return {
        "accounts": pd.read_csv(os.path.join(data_dir, "accounts.csv")),
        "devices": pd.read_csv(os.path.join(data_dir, "devices.csv")),
        "ips": pd.read_csv(os.path.join(data_dir, "ips.csv")),
        "referrals": pd.read_csv(os.path.join(data_dir, "referrals.csv")),
        "transactions": pd.read_csv(os.path.join(data_dir, "transactions.csv")),
        "payment_methods": pd.read_csv(os.path.join(data_dir, "payment_methods.csv")),
    }


# ── Postgres load ──────────────────────────────────────────────────────────
POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    account_id   TEXT PRIMARY KEY,
    signup_time  TIMESTAMP,
    kyc_status   TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id TEXT PRIMARY KEY,
    account_id     TEXT NOT NULL REFERENCES accounts(account_id),
    amount         DOUBLE PRECISION,
    timestamp      TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payment_methods (
    account_id          TEXT NOT NULL REFERENCES accounts(account_id),
    payment_method_type TEXT,
    payment_method_id   TEXT,
    PRIMARY KEY (account_id, payment_method_id)
);
-- Track which batch a record came from so /ingest re-runs are auditable.
ALTER TABLE accounts       ADD COLUMN IF NOT EXISTS batch TEXT;
ALTER TABLE transactions    ADD COLUMN IF NOT EXISTS batch TEXT;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS batch TEXT;
"""


def load_to_postgres(conn, data: dict[str, pd.DataFrame], batch: str = "default") -> dict:
    """Insert CSVs into Postgres. Idempotent via ON CONFLICT DO NOTHING."""
    counts = {"accounts": 0, "transactions": 0, "payment_methods": 0}
    cur = conn.cursor()

    cur.execute(POSTGRES_SCHEMA)

    accounts = data["accounts"]
    for _, row in accounts.iterrows():
        cur.execute(
            "INSERT INTO accounts (account_id, signup_time, kyc_status, batch) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT (account_id) DO NOTHING",
            (row["account_id"], row.get("signup_time"), row.get("kyc_status"), batch),
        )
    counts["accounts"] = cur.rowcount

    for _, row in data["transactions"].iterrows():
        cur.execute(
            "INSERT INTO transactions (transaction_id, account_id, amount, timestamp, batch) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (transaction_id) DO NOTHING",
            (row["transaction_id"], row["account_id"], row.get("amount"), row.get("timestamp"), batch),
        )
    counts["transactions"] = cur.rowcount

    for _, row in data["payment_methods"].iterrows():
        cur.execute(
            "INSERT INTO payment_methods (account_id, payment_method_type, payment_method_id, batch) "
            "VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (account_id, payment_method_id) DO NOTHING",
            (row["account_id"], row.get("payment_method_type"), row.get("payment_method_id"), batch),
        )
    counts["payment_methods"] = cur.rowcount

    conn.commit()
    return counts


# ── Neo4j load ─────────────────────────────────────────────────────────────
def load_to_neo4j(driver, data: dict[str, pd.DataFrame], batch: str = "default") -> dict:
    """
    Write relationship layer to Neo4j. All Cypher uses MERGE so re-runs add
    no duplicate relationships (fully idempotent). Returns per-label counts.
    """
    counts = {
        "accounts": 0,
        "device_edges": 0,
        "ip_edges": 0,
        "referral_edges": 0,
        "payments": 0,
    }

    with driver.session() as session:
        # Accounts (idempotent merge on node)
        for _, row in data["accounts"].iterrows():
            session.run(
                "MERGE (a:Account {account_id: $aid}) "
                "SET a.signup_time = $st, a.kyc_status = $kyc, a.batch = $batch",
                aid=row["account_id"], st=str(row.get("signup_time")),
                kyc=row.get("kyc_status"), batch=batch,
            )
            counts["accounts"] += 1

        # Account -> Device edges
        for _, row in data["devices"].iterrows():
            device_id = row["device_id"]
            for aid in _parse_account_ids(row["account_ids"]):
                session.run(
                    "MATCH (a:Account {account_id: $aid}) "
                    "MERGE (d:Device {device_id: $did}) "
                    "MERGE (a)-[:USES_DEVICE {batch: $batch}]->(d)",
                    aid=aid, did=device_id, batch=batch,
                )
                counts["device_edges"] += 1

        # Account -> IP edges
        for _, row in data["ips"].iterrows():
            ip = row["ip_address"]
            for aid in _parse_account_ids(row["account_ids"]):
                session.run(
                    "MATCH (a:Account {account_id: $aid}) "
                    "MERGE (i:IP {ip_address: $ip}) "
                    "MERGE (a)-[:CONNECTS_VIA_IP {batch: $batch}]->(i)",
                    aid=aid, ip=ip, batch=batch,
                )
                counts["ip_edges"] += 1

        # Referral edges (direction-preserving, ring metadata preserved).
        # NOTE: `ring_id` is null for normal referrals. A MERGE *pattern* cannot
        # contain a null property key in Neo4j, so we MERGE only on the batch
        # (never null) and SET the nullable fields afterward.
        for _, row in data["referrals"].iterrows():
            is_ring = bool(row.get("is_ring_referral"))
            ring_id = row.get("ring_id")
            session.run(
                "MATCH (a1:Account {account_id: $ref}), (a2:Account {account_id: $refd}) "
                "MERGE (a1)-[r:REFERRED {batch: $batch}]->(a2) "
                "SET r.is_ring_referral = $ring, r.ring_id = $rid",
                ref=row["referrer_id"], refd=row["referred_id"],
                ring=is_ring, rid=ring_id if is_ring else None, batch=batch,
            )
            counts["referral_edges"] += 1

        # Payment methods as nodes connected to accounts
        for _, row in data["payment_methods"].iterrows():
            session.run(
                "MATCH (a:Account {account_id: $aid}) "
                "MERGE (pm:PaymentMethod {id: $pmid, type: $pmtype}) "
                "MERGE (a)-[:HAS_PAYMENT_METHOD {batch: $batch}]->(pm)",
                aid=row["account_id"],
                pmid=row["payment_method_id"], pmtype=row.get("payment_method_type"), batch=batch,
            )
            counts["payments"] += 1

    return counts


def load_batch(
    data_dir: str,
    postgres_conn=None,
    neo4j_driver=None,
    batch: str = "default",
    skip_postgres: bool = False,
    skip_neo4j: bool = False,
    csvs: dict[str, pd.DataFrame] | None = None,
) -> dict:
    """Run the full loader for a batch dir against the given connections.

    Connections are injected so tests can pass in-memory stubs and so /ingest
    can reuse the app-level pools instead of opening new ones.
    """
    data = csvs if csvs is not None else load_csvs(data_dir)
    counts = {"data_dir": data_dir, "batch": batch}

    if postgres_conn is not None and not skip_postgres:
        counts["postgres"] = load_to_postgres(postgres_conn, data, batch)
        log.info("Postgres load complete: %s", counts["postgres"])

    if neo4j_driver is not None and not skip_neo4j:
        counts["neo4j"] = load_to_neo4j(neo4j_driver, data, batch)
        log.info("Neo4j load complete: %s", counts["neo4j"])

    return counts


def _main() -> None:
    parser = argparse.ArgumentParser(description="Load CSV batch into Postgres + Neo4j")
    parser.add_argument("--data-dir", default="data/raw", help="Path to a CSV batch directory")
    parser.add_argument("--batch", default="default", help="Batch label for audit")
    parser.add_argument("--skip-postgres", action="store_true")
    parser.add_argument("--skip-neo4j", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="[%(asctime)s] [%(levelname)s] [loader] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    t0 = time.time()

    if not args.skip_postgres:
        import psycopg2  # lazy
        conn = psycopg2.connect(**pg_config())
    else:
        conn = None

    driver = None
    if not args.skip_neo4j:
        from neo4j import GraphDatabase  # lazy
        cfg = neo4j_config()
        driver = GraphDatabase.driver(cfg["uri"], auth=(cfg["user"], cfg["password"]))
        try:
            driver.verify_connectivity()
        except Exception as e:  # noqa: BLE001
            log.warning("Neo4j not reachable (%s). Use --skip-neo4j to proceed without it.", e)

    try:
        counts = load_batch(
            args.data_dir,
            postgres_conn=conn,
            neo4j_driver=driver,
            batch=args.batch,
            skip_postgres=args.skip_postgres,
            skip_neo4j=args.skip_neo4j,
        )
        print(json_summary(counts, args.data_dir, time.time() - t0))
    finally:
        if conn:
            conn.close()
        if driver:
            driver.close()


def json_summary(counts: dict, data_dir: str, elapsed: float) -> str:
    import json
    out = {
        "status": "ok",
        "batch": counts.get("batch"),
        "data_dir": data_dir,
        "rows_loaded": {k: v for k, v in counts.items() if k not in ("data_dir", "batch")},
        "elapsed_seconds": round(elapsed, 2),
    }
    return json.dumps(out, default=str, indent=2)


if __name__ == "__main__":
    _main()
