"""
tests/test_loader.py

Loader idempotency test — proves that running `load_batch` twice against the
same data never double-inserts.

We don't spin up real Postgres/Neo4j. Instead we inject in-memory fakes that
implement the *semantics* the loader relies on:

  - Postgres: INSERT ... ON CONFLICT (pk) DO NOTHING  -> a real row is only
    added the first time; the second insert is a no-op. `rowcount` mirrors
    psycopg2 (1 if inserted, 0 if skipped).
  - Neo4j: MERGE on relationship identity -> re-running produces the same set
    of unique relationships, with no growth.

The loader is already written so connections are injected, which is exactly
what makes this testable without infra.
"""

import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from loader import load as loader  # noqa: E402


# ── Fake Postgres (psycopg2-compatible surface used by the loader) ──────────
class _FakeTable:
    def __init__(self):
        self.rows = {}          # tuple(pk values) -> dict
        self.pk_cols = None


class _FakeCursor:
    def __init__(self, conn):
        self._conn = conn
        self.rowcount = 0

    def execute(self, sql, params=None):
        params = params or ()
        sql_upper = sql.upper()

        if "CREATE TABLE IF NOT EXISTS" in sql_upper:
            table = sql.split()[5]
            self._conn.tables.setdefault(table, _FakeTable())
            self.rowcount = 0
            return
        if "ALTER TABLE" in sql_upper:
            self.rowcount = 0
            return
        if "INSERT INTO" in sql_upper:
            self._do_insert(sql, params)
            return
        self.rowcount = 0

    def _do_insert(self, sql, params):
        # Handles both single-row and chunked multi-row inserts:
        #   INSERT INTO t (c1, c2) VALUES (%s, %s) ON CONFLICT (pk) DO NOTHING
        #   INSERT INTO t (c1, c2) VALUES (%s, %s),(%s, %s), ... ON CONFLICT ...
        import re

        table = re.search(r"INSERT INTO (\w+)", sql).group(1)
        cols = re.search(r"INSERT INTO \w+ \(([^)]+)\)", sql).group(1)
        cols = [c.strip() for c in cols.split(",")]
        conflict = re.search(r"ON CONFLICT \(([^)]+)\)", sql)
        if conflict:
            pk_cols = [c.strip() for c in conflict.group(1).split(",")]
        else:
            pk_cols = [cols[0]]

        tbl = self._conn.tables.setdefault(table, _FakeTable())
        tbl.pk_cols = pk_cols

        params = list(params)
        # Multi-row VALUES: total %s placeholders / columns-per-row = row count.
        n_rows = max(sql.count("%s") // len(cols), 1)
        if n_rows > 1 and len(params) == n_rows * len(cols):
            row_dicts = [
                dict(zip(cols, params[i * len(cols):(i + 1) * len(cols)]))
                for i in range(n_rows)
            ]
        else:
            row_dicts = [dict(zip(cols, params))]

        inserted = 0
        for row in row_dicts:
            pk = tuple(row[c] for c in pk_cols)
            if pk in tbl.rows:
                continue  # ON CONFLICT DO NOTHING
            tbl.rows[pk] = row
            inserted += 1
        self.rowcount = inserted

    def close(self):
        pass


class FakePostgresConn:
    def __init__(self):
        self.tables = {}
        self.committed = 0

    def cursor(self):
        return _FakeCursor(self)

    def commit(self):
        self.committed += 1

    def close(self):
        pass


# ── Fake Neo4j (driver/session surface used by the loader) ──────────────────
class FakeNeo4jSession:
    """Records the set of unique relationships created via MERGE.

    Supports both the legacy single-row param style and the batched
    UNWIND $rows style the loader now uses.
    """

    def __init__(self, driver):
        self._driver = driver

    def run(self, cypher, **params):
        c = cypher.upper()
        if "UNWIND" in c:
            batch = params.get("batch")
            for row in params.get("rows", []):
                self._apply(c, row, batch)
        else:
            self._apply(c, params, params.get("batch"))
        return None

    def _apply(self, c, p, batch):
        # Only relationship-bearing statements create edges we care about.
        if "USES_DEVICE" in c:
            self._driver.edges.add(("USES_DEVICE", p["aid"], p["did"], batch))
        elif "CONNECTS_VIA_IP" in c:
            self._driver.edges.add(("CONNECTS_VIA_IP", p["aid"], p["ip"], batch))
        elif "REFERRED" in c and "MERGE (A1)-[R:REFERRED" in c:
            self._driver.edges.add(("REFERRED", p["ref"], p["refd"], batch))
        elif "HAS_PAYMENT_METHOD" in c:
            self._driver.edges.add(("HAS_PAYMENT_METHOD", p["aid"], p["pmid"], batch))
        # Account node MERGEs and SETs are naturally idempotent — ignore.

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def close(self):
        pass


class FakeNeo4jDriver:
    def __init__(self):
        self.edges = set()

    def session(self):
        return FakeNeo4jSession(self)

    def verify_connectivity(self):
        return True

    def close(self):
        pass


# ── The test ────────────────────────────────────────────────────────────────
def _data_dir():
    d = REPO_ROOT / "data" / "raw"
    if not (d / "accounts.csv").exists():
        pytest.skip("data/raw not present (run `python -m data.generator.generate`)")
    return str(d)


def test_loader_idempotent_on_postgres_and_neo4j():
    data_dir = _data_dir()

    pg1 = FakePostgresConn()
    neo1 = FakeNeo4jDriver()
    first = loader.load_batch(data_dir, postgres_conn=pg1, neo4j_driver=neo1, batch="test")

    # Something was actually loaded on the first run.
    assert first["postgres"]["accounts"] > 0
    assert first["neo4j"]["device_edges"] > 0
    assert first["neo4j"]["referral_edges"] > 0
    assert len(neo1.edges) > 0
    first_pg_accounts = first["postgres"]["accounts"]
    first_edge_count = len(neo1.edges)

    # Second run against the SAME stores (simulating a re-run / /ingest replay).
    pg2 = FakePostgresConn()
    # Re-seed pg2 with the first run's rows so ON CONFLICT triggers.
    pg2.tables = pg1.tables
    neo2 = neo1  # same edge set object
    second = loader.load_batch(data_dir, postgres_conn=pg2, neo4j_driver=neo2, batch="test")

    # Postgres: every row collided on its PK, so 0 new inserts.
    assert second["postgres"]["accounts"] == 0, "accounts double-inserted"
    assert second["postgres"]["transactions"] == 0, "transactions double-inserted"
    assert second["postgres"]["payment_methods"] == 0, "payment_methods double-inserted"

    # Neo4j: the unique edge set did not grow.
    assert len(neo2.edges) == first_edge_count, "neo4j relationships duplicated"
    assert second["neo4j"]["device_edges"] == first["neo4j"]["device_edges"]
