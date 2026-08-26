"""
Sentra — ML Model Training

Trains both RandomForest and XGBoost classifiers on component-level
features, compares them, and saves the winning model to disk.

Usage:
    python -m detection.train [--data-dir data/raw] [--labels-dir data/labels]

The trained model is saved to detection/model/ring_classifier.joblib.
A comparison report is printed to stdout.
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    roc_auc_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    classification_report,
)
from sklearn.model_selection import GridSearchCV, StratifiedKFold

try:
    from xgboost import XGBClassifier
    HAS_XGBOOST = True
except ImportError:
    HAS_XGBOOST = False

from detection.features import FEATURE_NAMES, extract_features_from_csvs

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).parent / "model"
MODEL_PATH = MODEL_DIR / "ring_classifier.joblib"


def load_ground_truth(labels_dir: str, split: str = "dev") -> dict[str, int]:
    """
    Load ground truth labels and return a dict mapping component_id → label.

    For training, we map ring membership to component-level labels:
    - A component is labeled 1 (ring) if ANY of its members are in the ground truth
    - A component is labeled 0 (legitimate) otherwise

    Args:
        labels_dir: path to labels directory
        split: "dev" or "test"
    """
    labels_path = os.path.join(labels_dir, f"ground_truth_{split}.json")
    with open(labels_path) as f:
        ground_truth = json.load(f)

    # ground_truth format: {"rings": [{"ring_id": ..., "members": [...]}]}
    ring_members = set()
    for ring in ground_truth.get("rings", []):
        ring_members.update(ring["members"])

    return ring_members


def label_components(
    components: list[dict],
    ring_members: set[str],
) -> list[int]:
    """
    Label components based on whether any member is in a known ring.

    Returns list of labels (0 or 1) aligned with components list.
    """
    labels = []
    for comp in components:
        has_ring_member = any(m in ring_members for m in comp["members"])
        labels.append(1 if has_ring_member else 0)
    return labels


def train_random_forest(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_dev: np.ndarray,
    y_dev: np.ndarray,
) -> tuple[RandomForestClassifier, dict]:
    """Train RandomForest with grid search, return best model and metrics."""
    logger.info("Training RandomForest...")

    param_grid = {
        "n_estimators": [100, 200, 500],
        "max_depth": [5, 10, 20, None],
        "min_samples_split": [2, 5, 10],
        "random_state": [42],
    }

    rf = RandomForestClassifier()
    cv = StratifiedKFold(n_splits=min(3, min(np.bincount(y_train.astype(int))), 5), shuffle=True, random_state=42)

    grid_search = GridSearchCV(
        rf, param_grid, cv=cv, scoring="roc_auc", n_jobs=-1, verbose=0
    )
    grid_search.fit(X_train, y_train)

    best_model = grid_search.best_estimator_
    y_pred = best_model.predict(X_dev)
    y_proba = best_model.predict_proba(X_dev)[:, 1]

    metrics = {
        "model": "RandomForest",
        "best_params": grid_search.best_params_,
        "cv_auc": round(grid_search.best_score_, 4),
        "dev_auc": round(roc_auc_score(y_dev, y_proba), 4),
        "dev_precision": round(precision_score(y_dev, y_pred, zero_division=0), 4),
        "dev_recall": round(recall_score(y_dev, y_pred, zero_division=0), 4),
        "dev_f1": round(f1_score(y_dev, y_pred, zero_division=0), 4),
        "confusion_matrix": confusion_matrix(y_dev, y_pred).tolist(),
        "feature_importance": dict(zip(FEATURE_NAMES, best_model.feature_importances_.tolist())),
    }

    return best_model, metrics


def train_xgboost(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_dev: np.ndarray,
    y_dev: np.ndarray,
) -> tuple:
    """Train XGBoost with grid search, return best model and metrics."""
    if not HAS_XGBOOST:
        logger.warning("XGBoost not installed, skipping")
        return None, None

    logger.info("Training XGBoost...")

    param_grid = {
        "n_estimators": [100, 200],
        "max_depth": [3, 5, 7],
        "learning_rate": [0.01, 0.1, 0.2],
        "random_state": [42],
    }

    xgb = XGBClassifier(
        eval_metric="logloss",
        use_label_encoder=False,
    )

    min_class_count = min(np.bincount(y_train.astype(int)))
    cv = StratifiedKFold(n_splits=min(3, min_class_count), shuffle=True, random_state=42)

    grid_search = GridSearchCV(
        xgb, param_grid, cv=cv, scoring="roc_auc", n_jobs=-1, verbose=0
    )
    grid_search.fit(X_train, y_train)

    best_model = grid_search.best_estimator_
    y_pred = best_model.predict(X_dev)
    y_proba = best_model.predict_proba(X_dev)[:, 1]

    metrics = {
        "model": "XGBoost",
        "best_params": grid_search.best_params_,
        "cv_auc": round(grid_search.best_score_, 4),
        "dev_auc": round(roc_auc_score(y_dev, y_proba), 4),
        "dev_precision": round(precision_score(y_dev, y_pred, zero_division=0), 4),
        "dev_recall": round(recall_score(y_dev, y_pred, zero_division=0), 4),
        "dev_f1": round(f1_score(y_dev, y_pred, zero_division=0), 4),
        "confusion_matrix": confusion_matrix(y_dev, y_pred).tolist(),
        "feature_importance": dict(zip(FEATURE_NAMES, best_model.feature_importances_.tolist())),
    }

    return best_model, metrics


def train_rule_based_baseline(
    X_dev: np.ndarray,
    y_dev: np.ndarray,
    components_dev: list[dict],
    temporal_results_dev: list[dict],
) -> dict:
    """
    Evaluate the rule-based baseline on the dev set for comparison.

    Uses the same weighted scoring logic from scoring.py but applied
    to the dev components.
    """
    from detection.scoring import score_component, WEIGHTS

    scores = []
    for comp, temporal in zip(components_dev, temporal_results_dev):
        result = score_component(comp, temporal)
        scores.append(result["ring_score"])

    scores = np.array(scores)
    y_pred = (scores >= 0.45).astype(int)

    metrics = {
        "model": "Rule-Based Baseline",
        "dev_auc": round(roc_auc_score(y_dev, scores), 4) if len(set(y_dev)) > 1 else 0.0,
        "dev_precision": round(precision_score(y_dev, y_pred, zero_division=0), 4),
        "dev_recall": round(recall_score(y_dev, y_pred, zero_division=0), 4),
        "dev_f1": round(f1_score(y_dev, y_pred, zero_division=0), 4),
        "confusion_matrix": confusion_matrix(y_dev, y_pred).tolist(),
    }

    return metrics


def main():
    parser = argparse.ArgumentParser(description="Train Sentra ring detection model")
    parser.add_argument("--data-dir", default="data/raw", help="Path to CSV directory")
    parser.add_argument("--labels-dir", default="data/labels", help="Path to labels directory")
    parser.add_argument("--output", default=str(MODEL_PATH), help="Output model path")
    args = parser.parse_args()

    # Extract features
    logger.info("Extracting features from CSVs...")
    X, component_ids, temporal_results, components, accounts_df = extract_features_from_csvs(
        args.data_dir
    )
    logger.info(f"Extracted {X.shape[0]} components, {X.shape[1]} features each")

    # Load ground truth
    logger.info("Loading ground truth labels...")
    ring_members = load_ground_truth(args.labels_dir, split="dev")
    y = label_components(components, ring_members)
    logger.info(f"Labels: {sum(y)} rings, {len(y) - sum(y)} legitimate")

    # Split into train/dev (80/20, stratified)
    from sklearn.model_selection import train_test_split

    indices = np.arange(len(y))
    train_idx, dev_idx = train_test_split(
        indices, test_size=0.2, stratify=y, random_state=42
    )

    X_train, X_dev = X[train_idx], X[dev_idx]
    y_train, y_dev = y[train_idx], y[dev_idx]
    components_dev = [components[i] for i in dev_idx]
    temporal_dev = [temporal_results[i] for i in dev_idx]

    logger.info(f"Train: {len(train_idx)} components ({sum(y_train)} rings)")
    logger.info(f"Dev: {len(dev_idx)} components ({sum(y_dev)} rings)")

    # Train models
    results = {}

    rf_model, rf_metrics = train_random_forest(X_train, y_train, X_dev, y_dev)
    if rf_metrics:
        results["RandomForest"] = rf_metrics
        logger.info(f"RandomForest dev AUC: {rf_metrics['dev_auc']}")

    xgb_model, xgb_metrics = train_xgboost(X_train, y_train, X_dev, y_dev)
    if xgb_metrics:
        results["XGBoost"] = xgb_metrics
        logger.info(f"XGBoost dev AUC: {xgb_metrics['dev_auc']}")

    # Rule-based baseline
    baseline_metrics = train_rule_based_baseline(X_dev, y_dev, components_dev, temporal_dev)
    results["Rule-Based Baseline"] = baseline_metrics
    logger.info(f"Rule-Based dev AUC: {baseline_metrics['dev_auc']}")

    # Select winner (highest AUC, fallback to F1)
    ml_models = {k: v for k, v in results.items() if k != "Rule-Based Baseline"}
    if ml_models:
        winner_name = max(ml_models, key=lambda k: (ml_models[k]["dev_auc"], ml_models[k]["dev_f1"]))
        winner_model = rf_model if winner_name == "RandomForest" else xgb_model
    else:
        winner_name = None
        winner_model = None

    # Print comparison report
    print("\n" + "=" * 60)
    print("MODEL COMPARISON REPORT")
    print("=" * 60)
    for name, metrics in results.items():
        print(f"\n--- {name} ---")
        for key, value in metrics.items():
            if key == "feature_importance":
                print(f"  {key}:")
                for feat, imp in sorted(value.items(), key=lambda x: x[1], reverse=True):
                    print(f"    {feat}: {imp:.4f}")
            else:
                print(f"  {key}: {value}")

    # Save winner
    if winner_model:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        joblib.dump(winner_model, args.output)
        print(f"\n{'=' * 60}")
        print(f"WINNER: {winner_name}")
        print(f"Saved to: {args.output}")
        print(f"{'=' * 60}")

        # Save comparison report
        report_path = MODEL_DIR / "training_report.json"
        with open(report_path, "w") as f:
            json.dump(results, f, indent=2, default=str)
        print(f"Report saved to: {report_path}")
    else:
        print("\nNo ML model trained — rule-based baseline is primary")
        # Save baseline config
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        report_path = MODEL_DIR / "training_report.json"
        with open(report_path, "w") as f:
            json.dump(results, f, indent=2, default=str)


if __name__ == "__main__":
    main()
