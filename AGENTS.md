# CLAUDE.md — Sentra

Context for Claude Code (or any AI assistant) working in this repo. Read this before making structural changes.

## What this is

Sentra is a fraud-ring detector built for the Razorpay AI Buildathon, Track 02 (AI Risk Manager — "Abuse-ring sentinel"). It detects coordinated signup/referral abuse rings (10–30 accounts sharing device/IP, signing up in a tight window, forming a closed-loop referral chain) as a graph-structure problem, not a per-transaction one.

Full spec lives in `sentra-prd.md` at repo root — read it first for anything beyond quick reference. This file is the condensed, working-session version.

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

## Repository layout

See PRD Section 13 for the full annotated tree. Key rule: every folder maps to a specific requirement above — don't add scaffolding (auth, migrations framework, k8s, etc.) that doesn't trace back to something in the PRD.

## Explicit non-goals — don't build these unless the PRD is updated first

- Anything beyond one fraud class (coordinated rings). No card-testing, no single-transaction fraud detection.
- Real-time/streaming incremental detection. Batch, re-runnable on demand, is the scope. If asked to "make it live," push back and point to PRD Section 4/9 non-goals — it doesn't help against the grading bar and risks the timeline.
- Production-grade dashboard: no auth, no real-time updates, no responsive design, no state-management library. Three screens only (ring list, subgraph view, explanation panel) plus the ingest button.
- Real Razorpay integration — synthetic data only.

## Conventions

- **Dataset generation is CSV-first.** Don't write directly into Postgres/Neo4j from the generator — iterate on ring realism in CSV form, then load via `loader/load.py`.
- **Dev/test split is sacred.** `evaluation/split.py` produces it once; `detection/` tuning code touches only the dev side. If you're about to compute or report a metric, check which split it came from.
- **Explainability is a first-class output, not a UI afterthought.** Every flagged ring must trace back to a concrete reason (`detection/explain.py`) — shared device/IP, signup window, referral cycle.
- **Graph visualization:** Cytoscape.js, fed directly with nodes/edges JSON from `graph_queries.py` output. Don't hand-roll layout.
- Keep normal (non-ring) synthetic accounts with some legitimate device/IP overlap (shared wifi/family) — a detector that flags every shared IP is trivially wrong and would misrepresent the false-positive-cost metric.

## When in doubt

Check `sentra-prd.md` first. If a request would contradict a locked decision in the PRD (dataset size, tech choices, scope boundaries), flag the conflict rather than silently resolving it — these were deliberate tradeoffs against a tight buildathon timeline.
