"""
API database layer — Postgres + Neo4j connection management.

Shared by every route so the whole API uses one Postgres pool and one Neo4j
driver. Connections are lazy so the API can start (and serve CSV-backed
detection) even before the databases are reachable.
"""

import logging
import os
from contextlib import contextmanager

log = logging.getLogger("api.db")

from loader.load import pg_config, neo4j_config  # noqa: E402

# Lazy singletons — created on first use, never at import time.
_pg_pool = None
_neo4j_driver = None


def _get_pg_pool():
    """Create (or return existing) psycopg2 ThreadedConnectionPool."""
    global _pg_pool
    if _pg_pool is None:
        import psycopg2
        from psycopg2 import pool
        import psycopg2.extras
        cfg = pg_config()
        _pg_pool = pool.ThreadedConnectionPool(
            minconn=1, maxconn=10, **cfg
        )
        psycopg2.extras.register_uuid()
    return _pg_pool


def get_pg_conn():
    """Return a connection from the shared pool (caller must close/return)."""
    return _get_pg_pool().getconn()


def return_pg_conn(conn, broken=False):
    if _pg_pool is not None:
        if broken:
            _pg_pool.putconn(conn, close=True)
        else:
            _pg_pool.putconn(conn)


@contextmanager
def pg_cursor():
    """Context manager yielding a cursor, committing on success, closing on exit."""
    conn = None
    try:
        conn = get_pg_conn()
        cur = conn.cursor()
        yield cur
        conn.commit()
    except Exception:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                return_pg_conn(conn, broken=True)
                conn = None
        raise
    finally:
        if conn is not None:
            return_pg_conn(conn)


def get_neo4j_driver():
    """Create (or return existing) Neo4j driver singleton."""
    global _neo4j_driver
    if _neo4j_driver is None:
        from neo4j import GraphDatabase
        cfg = neo4j_config()
        _neo4j_driver = GraphDatabase.driver(cfg["uri"], auth=(cfg["user"], cfg["password"]))
    return _neo4j_driver


def close_dbs():
    """Close pool + driver (used on app shutdown)."""
    global _pg_pool, _neo4j_driver
    if _neo4j_driver is not None:
        _neo4j_driver.close()
        _neo4j_driver = None
    if _pg_pool is not None:
        _pg_pool.closeall()
        _pg_pool = None


def neo4j_available() -> bool:
    """Probe Neo4j connectivity (best-effort — never raises)."""
    if os.getenv("SENTRA_SKIP_DB", "0") == "1":
        return False
    try:
        driver = get_neo4j_driver()
        driver.verify_connectivity()
        return True
    except Exception:  # noqa: BLE001
        return False


def pg_available() -> bool:
    """Probe Postgres connectivity (best-effort — never raises)."""
    if os.getenv("SENTRA_SKIP_DB", "0") == "1":
        return False
    conn = None
    try:
        conn = get_pg_conn()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        return True
    except Exception:  # noqa: BLE001
        return False
    finally:
        if conn is not None:
            return_pg_conn(conn)
