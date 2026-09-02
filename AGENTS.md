# AGENTS.md — Sentra

Context for any AI assistant (or engineer) working in this repo. Read this before making structural changes. This is the single canonical context file — there is no separate CLAUDE.md.

## What this is

Sentra is a fraud-ring detector built for the Razorpay AI Buildathon, Track 02 (AI Risk Manager — "Abuse-ring sentinel"). It detects coordinated signup/referral abuse rings (10–30 accounts sharing device/IP, signing up in a tight window, forming a closed-loop referral chain) as a graph-structure problem, not a per-transaction one.

Full spec lives in `docs/SENTRA PRD.md` — read it first for anything beyond quick reference. This file is the condensed, working-session version.

**Engineering-review defense:** `docs/design/engineering-review-answers.md` — answers to senior-staff technical questions (scalability, adversarial evasion, consistency, ML robustness, latency), with the implemented-vs-documented backlog. Read it before answering architecture challenges or extending the detector.

## Stack

- **Python 3.12+** — core engine, FastAPI, ML.
- **pandas / numpy** — CSV-first data handling.
- **networkx** — in-memory graph construction + connected components (single-node, scoped to ~500-account datasets; the migration path to Neo4j GDS/cuGraph is in the review doc §1).
- **scikit-learn RandomForest** — the winning classifier (XGBoost collapses to ~0.5 AUC on this sparse, tiny, imbalanced component data — see review doc §4a).
- **shap** — explainability (optional, graceful if missing; explainer is cached module-level).
- **FastAPI + uvicorn** — API layer. **PostgreSQL (psycopg2)** — transactional truth. **Neo4j** — relationship layer.
- **Docker Compose** — Postgres + Neo4j + API + Vite dashboard. **Cytoscape.js** — graph visualization.

## Structure

```
api/            FastAPI app: routes (rings, ingest, evaluate, audit, alerts, feedback),
                rings_service (composes detection for the dashboard), db, state, audit_ledger.
data/           generator/ (synthetic data + ring injection), raw|raw_test|raw_hard (CSV
                batches), labels/ (ground truth), output/, uploads/, feedback/, audit/.
detection/      Core engine: graph_queries (build_graph, find_components), features (16-dim),
                temporal, scoring (ML + rule-based), explain (SHAP), train, model/.
evaluation/     split.py (dev/test via independent seeds), evaluate.py (metrics + FP cost).
loader/         load.py — the ONLY ingestion path into Postgres + Neo4j (idempotent, batched).
dashboard/      Frontend (ring list, Cytoscape subgraph, explanation panel, ingest button).
tests/          test_loader.py (idempotency), test_detection.py (pure-function units).
docs/           PRD, design docs, engineering-review-answers.md, PROGRESS, ROADMAP.
```

## Grading bar (do not lose sight of this)

- Measured **precision/recall on a held-out test set** — never tune on data used for the reported metrics.
- **Honest false-positive cost** reported alongside accuracy — not just a headline number.
- **Strictly defense-only.** The synthetic-data generator's ring-injection logic exists solely to create labeled ground truth for evaluation. Never extend it into anything framed as "how to build an undetectable ring" as a product feature.
- Deliverables: public repo, 5-minute pitch video, architecture diagram, live audit trail in the demo.

## Build priority order — respect this when deciding what to work on next

1. **Core detection logic** — generator → CSVs → graph queries → scoring. Runs offline, no services. This alone must produce real precision/recall numbers.
2. **Real services** — Docker Compose (Postgres + Neo4j), loader script, FastAPI (`/rings`, `/ingest`, `/evaluate`).
3. **Extras** — dashboard (ring list, Cytoscape.js subgraph view, explanation panel), ML scoring upgrade, pitch-video polish.

If time runs out, whatever's furthest along in this order must still be a complete, demoable slice. Don't jump ahead to dashboard/extras work while step 1's metrics are still unproven.

## Architecture (see PRD Section 6 for the full diagram)

- **Postgres** — transactional truth: accounts, transactions, KYC status.
- **Neo4j** — relationship layer: account↔device, account↔ip, account↔referral edges. Ring structure (density, cycles, connected components) is a graph question, not a SQL one.
- **Loader (`loader/load.py`)** — the *only* path data takes into the databases, used both for the initial dataset and any later batch re-run via `/ingest`. Don't create a second ingestion path — that would break the "re-runnable on new batches" requirement.
- **Detection (`detection/`)** — has zero dependency on `api/`. Must stay directly unit-testable against `data/labels/ground_truth.json`.
- **Evaluation (`evaluation/`)** — has zero dependency on `detection/`'s tuning path. `evaluate.py` runs only against the held-out test split. This isolation is load-bearing for metric honesty — don't collapse it into `detection/` for convenience.

## Module map

| Concern | Owned by |
|---------|----------|
| Graph build + connected components | `detection/graph_queries.py` |
| 16-dim feature extraction (incl. referral degree features) | `detection/features.py` |
| Temporal burst signal | `detection/temporal.py` |
| Ring scoring (ML + rule-based) | `detection/scoring.py` |
| Explainability / SHAP | `detection/explain.py` |
| Model training + threshold selection | `detection/train.py` |
| Dev/test split | `evaluation/split.py` |
| Metrics + FP cost | `evaluation/evaluate.py` |
| Postgres + Neo4j ingestion | `loader/load.py` |
| API composition for dashboard | `api/rings_service.py` |
| Analyst HITL decisions + audit | `api/routes/feedback.py`, `api/audit_ledger.py` |
| Batch upload + re-detect | `api/routes/ingest.py` |

## Conventions

- **Dataset generation is CSV-first.** Don't write directly into Postgres/Neo4j from the generator — iterate on ring realism in CSV form, then load via `loader/load.py`.
- **Dev/test split is sacred.** `evaluation/split.py` produces it once (dev seed 42, test seed 137); `detection/` tuning code touches only the dev side. If you're about to compute or report a metric, check which split it came from.
- **Explainability is a first-class output, not a UI afterthought.** Every flagged ring must trace back to a concrete reason (`detection/explain.py`) — shared device/IP, signup window, referral cycle.
- **Graph visualization:** Cytoscape.js, fed directly with nodes/edges JSON from `graph_queries.py` output. Don't hand-roll layout.
- Keep normal (non-ring) synthetic accounts with some legitimate device/IP overlap (shared wifi/family) — a detector that flags every shared IP is trivially wrong and would misrepresent the false-positive-cost metric.
- **Idempotent, batched ingestion.** Postgres uses `ON CONFLICT DO NOTHING`, Neo4j uses `MERGE`, both written in chunks (UNWIND / multi-row). Re-running a batch converges both stores — there is no 2PC, by design (review doc §3a).

## Known gotchas / load-bearing decisions

- **`detection/` has zero dependency on `api/`** and must stay directly unit-testable. Don't pull API concerns into it.
- **`evaluation/` has zero dependency on `detection/`'s tuning path.** This isolation is load-bearing for metric honesty.
- **The ML decision threshold comes from `detection/model/threshold.json`** (selected by `train.py` on the validation slice). Never hardcode it — a past bug clobbered it with the UI band constant (0.80), desyncing the served operating point from the evaluated one and making the audit ledger record the wrong threshold. `tests/test_detection.py::test_served_threshold_matches_trained_artifact` guards this.
- **ML mode does not gate on temporal score** (unlike rule-based mode) — deliberate; the temporal gate silently drops hard rings. See `scoring.py` and review doc §2a.
- **CV is group-aware.** `train.py` groups components by ground-truth ring (`StratifiedGroupKFold` / `GroupShuffleSplit`) — row-level CV leaked ring fragments across folds and inflated validation AUC. Threshold selection counts **detectable clusters only** (size ≥ 5); undetectable singletons otherwise drag the threshold to ~0 and flag the entire population.
- **Referral degree-distribution features** (`max_out_degree`, `referral_depth`, `leaf_fraction`) exist because the N(N-1)/2 density normalization hides star/tree farming structures. They're the top SHAP contributors — don't remove them.
- **Analyst decisions are overlaid at read time** (`rings_service._apply_decisions`), not baked into the cached detection. Don't re-add cache invalidation on feedback — it forced a full pipeline re-run per click.
- **`/ingest` runs detection synchronously** under a global cache lock — a known, documented gap (review doc §3b). Fine for the 500-account demo; the async 202 + background-job design is the documented scale roadmap. Don't "fix" it before the pitch without updating the frontend.
- **Supernode risk is documented, not implemented:** `build_graph` does O(k²) pairwise edges per shared entity — a carrier-NAT IP would bridge a mega-component at scale. The cardinality-gate fix is pitch-defense material (review doc §1b), not built.
- **`/evaluate` computes `detectable_cluster_recall` live** — never replace it with a hardcoded constant. Note its hard-split numbers differ from `training_report.json` because the route evaluates the full hard dataset while the report uses the frozen 30% held-out slice.
- **The model artifact (`ring_classifier.joblib`) is gitignored** — regenerate with `python -m detection.train`. `threshold.json` and `training_report.json` are tracked.

## Explicit non-goals — don't build these unless the PRD is updated first

- Anything beyond one fraud class (coordinated rings). No card-testing, no single-transaction fraud detection.
- Real-time/streaming incremental detection. Batch, re-runnable on demand, is the scope. If asked to "make it live," push back and point to PRD Section 4/9 non-goals — it doesn't help against the grading bar and risks the timeline.
- Production-grade dashboard: no auth, no real-time updates, no responsive design, no state-management library. Three screens only (ring list, subgraph view, explanation panel) plus the ingest button.
- Real Razorpay integration — synthetic data only.

## When in doubt

Check `docs/SENTRA PRD.md` first. If a request would contradict a locked decision in the PRD (dataset size, tech choices, scope boundaries), flag the conflict rather than silently resolving it — these were deliberate tradeoffs against a tight buildathon timeline.
