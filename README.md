# SENTRA

Fraud-ring detector for the Razorpay AI Buildathon — detects coordinated signup/referral abuse rings as a graph-structure problem, not a per-transaction one.

## What it does

Identifies groups of 10–30 accounts sharing devices/IPs, signing up in tight windows, and forming closed-loop referral chains. Each flagged ring includes a concrete explanation (shared device/IP, signup window, referral cycle).

## Tech stack

- **Detection** — Python + NetworkX (graph queries, scoring, explainability)
- **Data** — Synthetic CSV generator with labeled ground truth
- **Infra** (WIP) — Postgres + Neo4j via Docker Compose, FastAPI API, React dashboard

## Quick start

```bash
# Generate synthetic data
python -m data.generator.generate

# Run detection
python -m detection.scoring

# Run evaluation
python -m evaluation.split
```

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