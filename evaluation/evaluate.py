"""
Sentra — Evaluation Pipeline

Compares flagged ring output against ground truth labels to compute
precision, recall, F1, and false-positive cost.

Supports three-way classification output from detection:
- flagged: auto-flagged (score >= threshold)
- needs_review: borderline candidates routed to human review
- clean: passed all filters

This module has zero dependency on detection/ — it reads the flagged
rings JSON and ground truth JSON as inputs, making it safe to run
only against the held-out test split.

Metrics are computed at two levels:
1. Ring-level: does each flagged/review ring correspond to a ground-truth ring?
2. Account-level: among all flagged accounts, how many are truly in rings?
"""

import json
import argparse
from pathlib import Path


def load_json(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def build_ring_sets(ground_truth: dict) -> list[set]:
    """Extract ground-truth ring membership as a list of sets."""
    return [set(ring["member_account_ids"]) for ring in ground_truth["rings"]]


def _match_category_to_gt(
    members_list: list[set], gt_rings: list[set], matched_gt: set
) -> tuple[list[dict], set]:
    """
    Match a category's member sets against ground truth.
    Returns per-ring match results and updated matched_gt set.
    """
    results = []
    for i, fm in enumerate(members_list):
        best_overlap = 0
        best_j = -1
        for j, gr in enumerate(gt_rings):
            if j in matched_gt:
                continue  # already matched by a higher-priority category
            overlap = len(fm & gr)
            if overlap > best_overlap:
                best_overlap = overlap
                best_j = j

        precision = best_overlap / len(fm) if len(fm) > 0 else 0
        recall = best_overlap / len(gt_rings[best_j]) if best_j >= 0 and len(gt_rings[best_j]) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        is_tp = best_overlap >= 0.5 * len(fm) and best_j >= 0
        if is_tp:
            matched_gt.add(best_j)

        results.append({
            "ring_idx": i,
            "size": len(fm),
            "matched_gt_idx": best_j,
            "gt_size": len(gt_rings[best_j]) if best_j >= 0 else 0,
            "overlap": best_overlap,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "is_true_positive": is_tp,
        })

    return results, matched_gt


def account_level_metrics(
    flagged_members: list[set],
    review_members: list[set],
    gt_rings: list[set],
    total_accounts: int,
) -> dict:
    """
    Account-level precision/recall/F1 for the flagged category.
    Also reports review_category recall (accounts caught by review).
    """
    all_flagged = set()
    for fm in flagged_members:
        all_flagged |= fm

    all_review = set()
    for rm in review_members:
        all_review |= rm

    all_gt = set()
    for gr in gt_rings:
        all_gt |= gr

    tp_flagged = len(all_flagged & all_gt)
    fp_flagged = len(all_flagged - all_gt)
    fn_flagged = len(all_gt - all_flagged)
    tn_flagged = total_accounts - tp_flagged - fp_flagged - fn_flagged

    # Review catches some of the false negatives from flagged
    tp_review = len(all_review & all_gt)
    fn_after_review = len(all_gt - all_flagged - all_review)

    precision = tp_flagged / (tp_flagged + fp_flagged) if (tp_flagged + fp_flagged) > 0 else 0
    recall = tp_flagged / (tp_flagged + fn_flagged) if (tp_flagged + fn_flagged) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    recall_with_review = (tp_flagged + tp_review) / (tp_flagged + fn_flagged) if (tp_flagged + fn_flagged) > 0 else 0

    return {
        "total_accounts": total_accounts,
        "flagged": {
            "true_positives": tp_flagged,
            "false_positives": fp_flagged,
            "false_negatives": fn_flagged,
            "true_negatives": tn_flagged,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
        },
        "flagged_plus_review": {
            "true_positives": tp_flagged + tp_review,
            "false_negatives_remaining": fn_after_review,
            "recall": round(recall_with_review, 4),
        },
    }


def evaluate(
    detection_output_path: str,
    ground_truth_path: str,
    total_accounts: int = 500,
) -> dict:
    """Full evaluation pipeline."""
    detection_output = load_json(detection_output_path)
    gt = load_json(ground_truth_path)

    gt_rings = build_ring_sets(gt)

    # Handle both old format (flat list) and new format (dict with categories)
    if isinstance(detection_output, list):
        flagged_members = [set(r.get("members", [])) for r in detection_output]
        review_members = []
    else:
        flagged_members = [set(r.get("members", [])) for r in detection_output.get("flagged", [])]
        review_members = [set(r.get("members", [])) for r in detection_output.get("needs_review", [])]

    # Ring-level: match flagged first, then review (against unmatched GT rings)
    matched_gt = set()
    flagged_matches, matched_gt = _match_category_to_gt(flagged_members, gt_rings, matched_gt)
    review_matches, matched_gt = _match_category_to_gt(review_members, gt_rings, matched_gt)

    missed = [j for j in range(len(gt_rings)) if j not in matched_gt]

    ring_metrics = {
        "flagged": {
            "matches": flagged_matches,
            "true_positives": sum(1 for m in flagged_matches if m["is_true_positive"]),
            "false_positives": sum(1 for m in flagged_matches if not m["is_true_positive"]),
        },
        "needs_review": {
            "matches": review_matches,
            "true_positives": sum(1 for m in review_matches if m["is_true_positive"]),
            "false_positives": sum(1 for m in review_matches if not m["is_true_positive"]),
        },
        "missed_gt_rings": missed,
    }

    account_metrics = account_level_metrics(
        flagged_members, review_members, gt_rings, total_accounts
    )

    return {
        "ring_level": ring_metrics,
        "account_level": account_metrics,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sentra evaluation pipeline")
    parser.add_argument("--flagged", required=True, help="Path to detection output JSON")
    parser.add_argument("--ground-truth", required=True, help="Path to ground truth JSON")
    parser.add_argument("--total-accounts", type=int, default=500, help="Total account count")
    parser.add_argument("--output", default=None, help="Optional output JSON path")
    args = parser.parse_args()

    results = evaluate(args.flagged, args.ground_truth, args.total_accounts)

    print("=" * 60)
    print("RING-LEVEL METRICS")
    print("=" * 60)

    rl = results["ring_level"]

    print("\n  Flagged:")
    for m in rl["flagged"]["matches"]:
        status = "TP" if m["is_true_positive"] else "FP"
        print(
            f"    Ring {m['ring_idx']}: size={m['size']}, "
            f"GT match={m['gt_size']}, overlap={m['overlap']}, "
            f"P={m['precision']:.2f}, R={m['recall']:.2f} [{status}]"
        )
    print(f"    TP: {rl['flagged']['true_positives']}, FP: {rl['flagged']['false_positives']}")

    print("\n  Needs review:")
    for m in rl["needs_review"]["matches"]:
        status = "TP" if m["is_true_positive"] else "FP"
        print(
            f"    Ring {m['ring_idx']}: size={m['size']}, "
            f"GT match={m['gt_size']}, overlap={m['overlap']}, "
            f"P={m['precision']:.2f}, R={m['recall']:.2f} [{status}]"
        )
    print(f"    TP: {rl['needs_review']['true_positives']}, FP: {rl['needs_review']['false_positives']}")

    print(f"\n  Missed GT rings: {rl['missed_gt_rings'] or 'None'}")

    print()
    print("=" * 60)
    print("ACCOUNT-LEVEL METRICS")
    print("=" * 60)
    al = results["account_level"]

    print(f"\n  Flagged only:")
    print(f"    Precision:  {al['flagged']['precision']:.4f}")
    print(f"    Recall:     {al['flagged']['recall']:.4f}")
    print(f"    F1:         {al['flagged']['f1']:.4f}")
    print(f"    FP:         {al['flagged']['false_positives']}")
    print(f"    FN:         {al['flagged']['false_negatives']}")

    print(f"\n  Flagged + review:")
    print(f"    Recall:     {al['flagged_plus_review']['recall']:.4f}")
    print(f"    TP:         {al['flagged_plus_review']['true_positives']}")
    print(f"    FN remain:  {al['flagged_plus_review']['false_negatives_remaining']}")

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nWrote results to {output_path}")
