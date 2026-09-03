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
| Hard test (held-out, subtle rings) | 1.000 | 0.800 | 1.000 | 0 |

Obvious rings are caught with zero false positives. Subtle "hard" rings fragment into
small components (only 50% device / 40% IP overlap), so the *few* members that form no
cluster are undetectable by construction — but every hard ring that forms a real cluster
is caught. The rule-based baseline, by contrast, floods review with false positives
(easy P≈0.05, hard P≈0.07). Full breakdown in `detection/model/training_report.json`.

## Architecture

```
┌─────────────────┐        ┌───────────────────────────┐
│  Data Generator  │        │  New batch (any later CSV │
│  (synthetic,      │        │  of accounts/devices/     │
│  initial dataset) │        │  transactions/referrals)  │
└────────┬─────────┘        └────────────┬───────────────┘
         │                                │
         │  loader/load.py (single path for BOTH:
         │  initial load and any later re-run on a batch)
         ▼                                ▼
┌─────────────────────────────┬───────────────────────────┐
│         Postgres            │           Neo4j            │
│  transactional truth:       │  relationship graph:       │
│  accounts, transactions,    │  account↔device,           │
│  KYC status                 │  account↔ip,               │
│                             │  account↔referral          │
└──────────────┬───────────────┴────────────┬─────────────┘
               │                               │
               ▼                               ▼
        ┌───────────────────────────────────────────┐
        │           Detection engine (offline)        │
        │  - graph_queries: connected components on   │
        │    shared device/IP + referral-cycle density │
        │  - temporal: signup-window clustering        │
        │  - features: 16-dim component vector         │
        │  - ML classifier: RandomForest/XGBoost        │
        │  - explainability: SHAP + plain-language       │
        └───────────────────┬───────────────────────┘
                            ▼
                 ┌────────────────────────────────┐
                 │   API layer (FastAPI)           │
                 │  /rings  /rings/{id}            │
                 │  /rings/{id}/subgraph           │
                 │  /evaluate  /ingest  /audit      │
                 └───────────┬────────────────────────┘
                             ▼
                 ┌───────────────────────────┐
                 │  Dashboard (React + Vite)  │
                 │  - ranked ring list        │
                 │  - subgraph view (Cytoscape)│
                 │  - explanation panel       │
                 │  - ingest button → /ingest  │
                 └───────────────────────────┘
```

Postgres is the row-level source of truth; Neo4j is the relationship layer ring
structure (density, cycles, connected components) is a graph question, not a SQL
one. The loader is the *only* path data enters the databases, so re-running on a
new batch is safe and idempotent. `detection/` and `evaluation/` have zero
dependency on `api/` and are unit-testable directly against ground truth.

## Run the whole stack (Docker Compose)

```bash
cp .env.example .env          # adjust credentials if you like
docker compose up --build     # postgres + neo4j + api + dashboard
```

The API self-bootstraps on first run (generate data → train model → load initial
batch → serve). Then:

- Dashboard: http://localhost:5173
- API docs:    http://localhost:8000/docs
- Health:      http://localhost:8000/health

To re-run detection on a new CSV batch, `POST` it to `/ingest` (or use the
dashboard's ingest button) — it routes through the same `loader/load.py`.

## Project structure

```
sentra/
├── data/
│   ├── generator/    # Synthetic data generator
│   ├── labels/       # Ground truth (dev/test splits)
│   └── raw/          # Generated CSVs (gitignored)
├── detection/        # Graph queries, scoring, explainability
├── evaluation/       # Precision/recall/F1 on held-out test set
├── api/              # FastAPI endpoints
├── dashboard/        # React UI
├── loader/           # CSV → Postgres/Neo4j loader
└── docs/             # PRD, roadmap
```