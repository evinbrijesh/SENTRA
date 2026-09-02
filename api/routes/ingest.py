"""
/ingest route — accept a batch (zip of CSVs), load it into Postgres/Neo4j via
the shared loader, make it the active batch, and re-run detection.

This is the same loader path used for the initial dataset — no second ingestion
code path (PRD Section 6). If the databases are unreachable, the batch is still
made active and detection runs CSV-backed, so the demo degrades gracefully.
"""

import logging
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from api import state
from api.rings_service import ring_list, clear_detection_cache
from loader.load import load_batch, load_csvs

log = logging.getLogger("api.routes.ingest")

router = APIRouter()

REQUIRED_CSVS = {"accounts", "devices", "ips", "referrals", "transactions", "payment_methods"}
UPLOAD_ROOT = Path("data/uploads")


def _extract_zip(zip_path: Path) -> Path:
    """Extract a batch zip into a fresh, unique batch dir, validating CSVs."""
    batch_id = uuid.uuid4().hex[:8]
    dest = UPLOAD_ROOT / f"batch_{batch_id}"
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(dest)
    found = {p.stem for p in dest.glob("*.csv")}
    missing = REQUIRED_CSVS - found
    if missing:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(
            status_code=400,
            detail=f"Batch is missing required CSV files: {', '.join(sorted(missing))}",
        )
    return dest


def _load_with_degradation(batch_dir: Path, batch_id: str, csvs: dict | None = None) -> dict:
    """Run loader against live DBs when available; degrade to CSV-only otherwise.

    `csvs` passes the already-parsed DataFrames through so the batch is not
    parsed from disk a second time (the route validates them first).
    """
    import os
    import api.db as db

    pg_conn = None
    driver = None
    skip_db = os.getenv("SENTRA_SKIP_DB", "0") == "1"

    if not skip_db:
        try:
            pg_conn = db.get_pg_conn()
        except Exception as e:  # noqa: BLE001
            log.warning("postgres unavailable, skipping PG load: %s", e)
        try:
            if db.neo4j_available():
                driver = db.get_neo4j_driver()
        except Exception as e:  # noqa: BLE001
            log.warning("neo4j unavailable, skipping graph load: %s", e)

    counts = load_batch(
        str(batch_dir),
        postgres_conn=pg_conn,
        neo4j_driver=driver,
        batch=batch_id,
        skip_postgres=pg_conn is None,
        skip_neo4j=driver is None,
        csvs=csvs,
    )

    if pg_conn is not None:
        try:
            db.return_pg_conn(pg_conn)
        except Exception:  # noqa: BLE001
            db.return_pg_conn(pg_conn, broken=True)

    return counts


@router.post("/ingest")
async def ingest(file: UploadFile = File(...)):
    filename = (file.filename or "").lower()
    if not filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload a .zip batch of CSV files")

    # Stream upload to a temp file (size cap safeguard).
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        while True:
            chunk = await file.read(4 * 1024 * 1024)
            if not chunk:
                break
            tmp.write(chunk)
        tmp_path = Path(tmp.name)

    try:
        batch_dir = _extract_zip(tmp_path)
    except HTTPException:
        tmp_path.unlink(missing_ok=True)
        raise
    except zipfile.BadZipFile:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid zip archive")

    # Sanity: the batch must parse as CSVs before we make it active.
    try:
        data = load_csvs(str(batch_dir))
    except Exception as e:  # noqa: BLE001
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Batch CSVs could not be parsed: {e}")
    finally:
        tmp_path.unlink(missing_ok=True)

    batch_id = batch_dir.name
    # Pass the parsed CSVs through so load_batch doesn't re-read them from disk.
    counts = _load_with_degradation(batch_dir, batch_id, csvs=data)

    # Make it active so /rings reflects the new batch immediately.
    state.set_active_data_dir(str(batch_dir))
    clear_detection_cache()

    rings = ring_list(str(batch_dir))
    for r in rings:
        r.pop("explanation", None)
        r.pop("members", None)

    return {
        "status": "ok",
        "batch_id": batch_id,
        "rows_loaded": counts,
        "ring_count": len(rings),
        "rings": rings,
    }
