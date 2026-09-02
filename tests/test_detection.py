"""
tests/test_detection.py

Unit tests for the pure detection functions — the module the architecture
claims is "directly unit-testable". These would have caught, among others:

  - the served-threshold desync (scoring.DEFAULT_THRESHOLD clobbered by the
    UI band constant, so the API flagged at 0.80 while metrics were reported
    at the trained 0.45);
  - undetectable singletons dragging the recall-oriented threshold to ~0
    (flagging the entire population);
  - the referral degree-distribution features collapsing on stars/cycles.

No databases, no network — CSV data is read from data/raw when present and
those tests skip gracefully otherwise.
"""

import json
import sys
from pathlib import Path

import networkx as nx
import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from detection import scoring  # noqa: E402
from detection.features import (  # noqa: E402
    FEATURE_NAMES,
    compute_referral_degree_features,
)
from detection.graph_queries import build_graph, find_components, load_csvs  # noqa: E402
from detection.train import (  # noqa: E402
    build_groups,
    group_split,
    label_components,
    recall_oriented_threshold,
)

MODEL_DIR = REPO_ROOT / "detection" / "model"


# ── Threshold / artifact consistency ───────────────────────────────────────
def test_served_threshold_matches_trained_artifact():
    """The threshold the API serves must be the one train.py selected.

    Regression guard: scoring.py once loaded threshold.json and then
    unconditionally overwrote DEFAULT_THRESHOLD with the UI band constant
    (0.80), so the served operating point silently diverged from the
    evaluated one — and the audit ledger recorded the artifact's threshold.
    """
    threshold_path = MODEL_DIR / "threshold.json"
    if threshold_path.exists():
        artifact = json.loads(threshold_path.read_text())
        assert scoring.DEFAULT_THRESHOLD == artifact["threshold"], (
            "served threshold desynced from detection/model/threshold.json — "
            "DEFAULT_THRESHOLD must not be overwritten after the artifact load"
        )
    else:
        assert scoring.DEFAULT_THRESHOLD == 0.45  # documented fallback


def test_feature_vector_dimension_consistency():
    """The trained model's input width must match FEATURE_NAMES."""
    assert len(FEATURE_NAMES) == 16
    model_path = MODEL_DIR / "ring_classifier.joblib"
    if model_path.exists():
        import joblib

        model = joblib.load(model_path)
        assert model.n_features_in_ == len(FEATURE_NAMES), (
            "model was trained on a different feature count than the current "
            "extractor — retrain with `python -m detection.train`"
        )


# ── Group-aware CV ──────────────────────────────────────────────────────────
def test_build_groups_components_from_same_ring_share_group():
    components = [
        {"component_id": 0, "members": ["r1a", "r1b"]},
        {"component_id": 1, "members": ["r1c"]},          # same GT ring, fragmented
        {"component_id": 2, "members": ["x", "y"]},       # clean
        {"component_id": 3, "members": ["r2a"]},          # second GT ring
    ]
    gt_rings = [{"r1a", "r1b", "r1c"}, {"r2a"}]
    groups = build_groups(components, gt_rings)

    assert groups[0] == groups[1]          # fragments of ring 0 grouped together
    assert groups[0].startswith("ring:")
    assert groups[2].startswith("comp:")   # clean components are their own group
    assert groups[3] == "ring:1"
    assert len(set(groups)) == 3


def test_group_split_never_straddles_a_ring():
    rng = np.random.RandomState(0)
    X = rng.rand(10, 4)
    y = np.array([1, 1, 1, 0, 0, 0, 0, 0, 0, 0])
    groups = np.array(["ringA", "ringA", "ringA"] + [f"c{i}" for i in range(7)], dtype=object)

    X_tr, X_te, y_tr, y_te, tr_idx, te_idx = group_split(X, y, groups, test_size=0.3, seed=42)

    ring_locations = {("tr" if i in set(tr_idx) else "te") for i, g in enumerate(groups) if g == "ringA"}
    assert len(ring_locations) == 1, "a ground-truth ring straddled the train/test split"


def test_label_components_any_member_match():
    components = [{"members": ["a", "b"]}, {"members": ["c"]}]
    assert label_components(components, {"a"}) == [1, 0]


# ── Threshold selection ─────────────────────────────────────────────────────
def test_recall_threshold_ignores_undetectable_singletons():
    """Undetectable singletons (size 1) must not drag the threshold to ~0.

    Failure mode being guarded: with 2 singletons at proba 0.01 and one
    detectable ring at 0.90, a size-blind recall floor demands ALL positives
    be caught, collapsing the threshold to 0.01 and flagging the entire
    population (304+ FPs in the real training run).
    """
    y = np.array([1, 1, 1, 0, 0, 0, 0, 0, 0, 0])
    proba = np.array([0.01, 0.01, 0.90, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05])
    sizes = np.array([1, 1, 10, 3, 3, 3, 3, 3, 3, 3])

    t_blind = recall_oriented_threshold(y, proba, target_recall=0.9)
    t_detectable = recall_oriented_threshold(y, proba, target_recall=0.9, sizes=sizes)

    assert t_blind <= 0.01          # the failure mode: flags everything
    assert t_detectable == 0.90     # sits above every negative (0.05)
    assert t_detectable > t_blind


# ── Referral degree-distribution features ───────────────────────────────────
def _graph_with_referrals(edges) -> nx.Graph:
    G = nx.Graph()
    dg = nx.DiGraph()
    dg.add_edges_from(edges)
    G.graph["referral_digraph"] = dg
    return G


def test_degree_features_detect_referral_star():
    """A farming star (1 root -> N leaves) must stand out: high max_out_degree,
    shallow depth, high leaf_fraction — the signal that survives cycle removal."""
    G = _graph_with_referrals([("root", "l1"), ("root", "l2"), ("root", "l3"), ("root", "l4")])
    members = ["root", "l1", "l2", "l3", "l4"]
    feats = compute_referral_degree_features(members, G)

    assert feats["max_out_degree"] == 4
    assert feats["referral_depth"] == 1
    assert feats["leaf_fraction"] == round(4 / 5, 4)


def test_degree_features_closed_cycle_has_no_leaves():
    G = _graph_with_referrals([("a", "b"), ("b", "c"), ("c", "a")])
    feats = compute_referral_degree_features(["a", "b", "c"], G)

    assert feats["max_out_degree"] == 1
    assert feats["leaf_fraction"] == 0.0   # closed loop: everyone refers someone
    assert feats["referral_depth"] >= 1    # BFS fallback on the cyclic subgraph


def test_degree_features_chain_depth():
    G = _graph_with_referrals([("a", "b"), ("b", "c"), ("c", "d")])
    feats = compute_referral_degree_features(["a", "b", "c", "d"], G)

    assert feats["max_out_degree"] == 1
    assert feats["referral_depth"] == 3
    assert feats["leaf_fraction"] == round(1 / 4, 4)


def test_degree_features_no_referrals():
    G = nx.Graph()
    G.graph["referral_digraph"] = nx.DiGraph()
    feats = compute_referral_degree_features(["a", "b"], G)
    assert feats == {"max_out_degree": 0, "referral_depth": 0, "leaf_fraction": 0.0}


# ── Detection pipeline ──────────────────────────────────────────────────────
def test_detect_rings_accepts_prebuilt_graph():
    """Regression: rings_service passes its graph/components through so the
    graph is not built twice per detection run. Both paths must agree."""
    data_dir = REPO_ROOT / "data" / "raw"
    if not (data_dir / "accounts.csv").exists():
        pytest.skip("data/raw not present (run `python -m data.generator.generate`)")

    data = load_csvs(str(data_dir))
    G = build_graph(data)
    components = find_components(G)

    rebuilt = scoring.detect_rings(data=data, use_ml=True)
    reused = scoring.detect_rings(data=data, use_ml=True, graph=G, components=components)

    assert [r["component_id"] for r in reused["flagged"]] == \
           [r["component_id"] for r in rebuilt["flagged"]]
    assert [r["ring_score"] for r in reused["flagged"]] == \
           [r["ring_score"] for r in rebuilt["flagged"]]


# ── Analyst decision overlay ────────────────────────────────────────────────
def test_decision_overlay_applied_at_read_time(monkeypatch):
    """Decisions must be overlaid on the copied result, not baked into the
    cached detection (which forced a full pipeline re-run per analyst click)."""
    from api import rings_service

    run = {
        "flagged": [{
            "component_id": "7",
            "status": "flagged",
            "estimated_exposure_gmv": 100.0,
        }],
        "needs_review": [],
        "clean": [],
        "operational_summary": {},
    }
    monkeypatch.setattr(
        "api.routes.feedback.get_decision_for_ring",
        lambda rid: {"action": "DISMISS_FALSE_POSITIVE"} if rid == "7" else None,
    )

    rings_service._apply_decisions(run)
    assert run["flagged"][0]["status"] == "dismissed_fp"

    rings_service._recompute_status_summary(run)
    # Dismissed rings are excluded from active exposure
    assert run["operational_summary"]["flagged_exposure_gmv"] == 0.0
    assert run["operational_summary"]["confirmed_fraud_count"] == 0
