"""
Sentra — Dev/Test Split via Independent Seed Batches

Instead of splitting one dataset (too few rings for statistical validity),
we generate two fully independent datasets with different seeds:

  - Dev:  seed 42  → data/raw/       + data/labels/ground_truth_dev.json
  - Test: seed 137 → data/raw_test/  + data/labels/ground_truth_test.json

Each batch has its own 3 rings, never seen by the other. Threshold tuning
happens exclusively on dev; test numbers are frozen once computed.

This module has ZERO dependency on detection/ — it only orchestrates
the generator and provides path constants.
"""

import json
import os
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
LABELS_DIR = DATA_DIR / "labels"

DEV_DIR = DATA_DIR / "raw"
TEST_DIR = DATA_DIR / "raw_test"
DEV_SEED = 42
TEST_SEED = 137


def create_split(force: bool = False) -> dict:
    """
    Generate both batches if they don't exist (or if force=True).

    Returns dict with paths to both batches and their ground truth files.
    """
    from data.generator.generate import generate

    dev_gt = LABELS_DIR / "ground_truth_dev.json"
    test_gt = LABELS_DIR / "ground_truth_test.json"

    os.makedirs(LABELS_DIR, exist_ok=True)

    if force or not DEV_DIR.exists() or not dev_gt.exists():
        print("Generating dev batch (seed 42)...")
        generate(
            output_dir=str(DEV_DIR),
            seed=DEV_SEED,
            labels_filename="ground_truth_dev",
        )

    if force or not TEST_DIR.exists() or not test_gt.exists():
        print("Generating test batch (seed 137)...")
        generate(
            output_dir=str(TEST_DIR),
            seed=TEST_SEED,
            labels_filename="ground_truth_test",
        )

    return {
        "dev": {
            "data_dir": str(DEV_DIR),
            "ground_truth_path": str(dev_gt),
        },
        "test": {
            "data_dir": str(TEST_DIR),
            "ground_truth_path": str(test_gt),
        },
    }


def load_ground_truth(split: str = "dev") -> dict:
    """Load ground truth for a split ('dev' or 'test')."""
    path = LABELS_DIR / f"ground_truth_{split}.json"
    if not path.exists():
        raise FileNotFoundError(
            f"Ground truth for '{split}' not found at {path}. "
            "Run create_split() first."
        )
    with open(path) as f:
        return json.load(f)


def get_data_dir(split: str = "dev") -> str:
    """Return the CSV directory for a split."""
    if split == "dev":
        return str(DEV_DIR)
    elif split == "test":
        return str(TEST_DIR)
    else:
        raise ValueError(f"Unknown split: '{split}'. Use 'dev' or 'test'.")


if __name__ == "__main__":
    paths = create_split()
    print(f"\nSplit ready:")
    print(f"  Dev:  {paths['dev']['data_dir']}")
    print(f"  Test: {paths['test']['data_dir']}")
