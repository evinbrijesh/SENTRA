"""Runtime state shared across API routes.

Tracks which batch directory is the "active" one that /rings and /rings/{id}
serve from. Starts at the default dev batch; POST /ingest points it at the
newly-ingested batch so the dashboard immediately reflects new data.
"""

import logging
import threading

log = logging.getLogger("api.state")

_lock = threading.Lock()
_active_data_dir = "data/raw"


def get_active_data_dir() -> str:
    return _active_data_dir


def set_active_data_dir(data_dir: str) -> None:
    global _active_data_dir
    with _lock:
        _active_data_dir = data_dir
        log.info("active data dir set to %s", data_dir)
