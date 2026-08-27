# SENTRA

Fraud-ring detector for the Razorpay AI Buildathon — detects coordinated signup/referral abuse rings as a graph-structure problem, not a per-transaction one.

## What it does

Identifies groups of 10–30 accounts sharing devices/IPs, signing up in tight windows, and forming closed-loop referral chains. **Detection is driven by a trained ML model (RandomForest/XGBoost)** — not hand-written rules — that learns the weighting of structural, temporal, and referral signals from labeled data. Each flagged ring includes:
- A **learned probability** (calibrated confidence from the model)
- **SHAP values** showing exactly which features drove the decision and by how much
- A plain-language audit trail (shared device/IP, signup window, referral cycle)

## Tech stack

- **Detection** — Python + NetworkX (graph), scikit-learn/XGBoost (learned scoring), SHAP (explainability)
- **Data** — Synthetic CSV generator with labeled ground truth (dev/test splits)
- **Infra** — Postgres + Neo4j via Docker Compose (`docker-compose.yml`), FastAPI (`api/`), loader (`loader/`), React dashboard (`dashboard/`)

## Quick start

```bash
# 1. Generate data (easy + hard stress set)
python -m data.generator.generate          # easy  (data/raw, data/raw_test)
python -m data.generator.generate_hard     # hard  (data/raw_hard)

# 2. Train the ML model — trained on BOTH easy + hard rings, evaluated on two
#    INDEPENDENT held-out sets (easy test + frozen hard test slice).
python -m detection.train

# 3. Run detection (ML-primary, SHAP explanations included)
python -m detection.scoring --data-dir data/raw_test --output data/output/flagged_rings_test.json

# 4. Evaluate against ground truth (ring-level + account-level, with FP/FN cost)
python -m evaluation.evaluate --flagged data/output/flagged_rings_test.json \
       --ground-truth data/labels/ground_truth_test.json --total-accounts 500
```

## Honest metrics (held-out, never tuned on)

Detection is a **graph-structure** problem, so accounts that share *no* device/IP/referral
with a co-conspirator form no cluster and are inherently undetectable. We report both
overall and **detectable-cluster** recall (rings that actually form a cluster of size ≥ 5):

| Set | Precision | Recall | Detectable-cluster recall | FP |
|-----|-----------|--------|---------------------------|----|
| Easy test (held-out) | 1.000 | 1.000 | 1.000 | 0 |
| Hard test (held-out, subtle rings) | 1.000 | 0.444 | 1.000 | 0 |

Obvious rings are caught with zero false positives. Subtle "hard" rings fragment into
small components (only 50% device / 40% IP overlap), so the *few* members that form no
cluster are undetectable by construction — but every hard ring that forms a real cluster
is caught. The rule-based baseline, by contrast, floods review with false positives
(easy P≈0.05, hard P≈0.07). Full breakdown in `detection/model/training_report.json`.

## Project structure

```
sentra/
├── data/
│   ├── generator/    # Synthetic data generator
│   ├── labels/       # Ground truth (dev/test splits)
│   └── raw/          # Generated CSVs (gitignored)
├── detection/        # Graph queries, scoring, explainability
├── evaluation/       # Precision/recall/F1 on held-out test set
├── api/              # FastAPI endpoints (WIP)
├── dashboard/        # React UI (WIP)
├── loader/           # CSV → Postgres/Neo4j loader (WIP)
└── docs/             # PRD, roadmap
```