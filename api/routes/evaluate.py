"""
/evaluate route — reports precision/recall/F1 + false-positive cost on the
held-out test split.

Uses the same evaluation.evaluate pipeline that produced the frozen Day-3
metrics, recomputed on demand (cached) so the number the dashboard shows is
always consistent with the actual detection run.
"""

import logging
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException

from evaluation.evaluate import evaluate as run_eval

log = logging.getLogger("api.routes.evaluate")

router = APIRouter()

DATA_DIR = Path("data")
TEST_DIR = DATA_DIR / "raw_test"


@lru_cache(maxsize=4)
def _test_metrics() -> dict:
    """Run detection on the held-out test split and evaluate against truth."""
    from api.rings_service import run_detection

    flagged_path = Path("data/output/") / "api_test_flagged.json"
    flagged_path.parent.mkdir(parents=True, exist_ok=True)

    run = run_detection(str(TEST_DIR))
    import json
    # evaluation.evaluate reads a dict-formatted detection output {flagged, needs_review}
    output = {
        "flagged": [
            {"component_id": r["component_id"], "members": r["members"]} for r in run["flagged"]
        ],
        "needs_review": [
            {"component_id": r["component_id"], "members": r["members"]} for r in run["needs_review"]
        ],
    }
    with open(flagged_path, "w") as f:
        json.dump(output, f)

    gt = DATA_DIR / "labels" / "ground_truth_test.json"
    if not gt.exists():
        raise FileNotFoundError(f"Ground truth not found: {gt}")

    total = json.loads(gt.read_text()).get("total_accounts", 500)
    return run_eval(str(flagged_path), str(gt), total_accounts=total)


@router.get("/evaluate")
def get_evaluate():
    try:
        metrics = _test_metrics()
    except Exception as e:  # noqa: BLE001
        log.error("evaluate failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {e}")

    al = metrics["account_level"]
    flagged = al["flagged"]
    cost = {
        "false_positives": flagged["false_positives"],
        "false_negative_accounts": flagged["false_negatives"],
        "false_positive_rate": round(flagged["false_positives"] / max(al["total_accounts"], 1), 4),
    }
    return {
        "split": "test",
        "ring_level": metrics["ring_level"],
        "account_level": al,
        "false_positive_cost": cost,
        "honest_note": "Reported on the held-out test split only; thresholds tuned on dev.",
    }
