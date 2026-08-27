# Sentra — Progress Log

Living status of the build against `docs/ROADMAP.md`. Updated as work lands.
Last update: 2026-08-27.

> **Note:** the Day 3 numbers were corrected (the earlier inflated
> `Hard R=0.71 → 0.93` was replaced with the dual held-out figures below).
> `ROADMAP.md` Day 3 now shows the current, accurate metrics — see it for the
> authoritative numbers.

---

## Status by roadmap day

| Day | Topic | State | Notes |
|-----|-------|-------|-------|
| 1 | Repo scaffold + generator | ✅ Done | `data/generator/` produces labeled CSVs; legit device/IP overlap present |
| 2 | Detection engine | ✅ Done | `graph_queries`, `temporal`, `scoring`, `explain` all working offline |
| 3 | Evaluation + held-out metrics | ✅ Done (metrics corrected) | Dual held-out eval; honest FP cost reported |
| 4 | Infra + loader | ✅ Done (verified) | `docker compose up` boots all 4 containers healthy; data loaded to Postgres + Neo4j; two loader/DB bugs found & fixed |
| 5 | API layer | ✅ Done (verified) | All endpoints live in Docker with both DBs reachable; subgraph served from Neo4j |
| 6 | Dashboard | ✅ Done (browser verified) | Click-through exercised headless: real KPIs, ring list, ring detail (explanation + subgraph + shared entities), metrics all render from live API |
| 7 | Integration / pitch / video | 🟡 In progress | arch diagram + README done; pitch video + public repo push remaining |

---

## What is actually complete

### Core detection (priority 1 — the graded deliverable)
- **Synthetic data**: easy set (`data/raw`, `data/raw_test`) + hard stress set
  (`data/raw_hard`, regrown to 15 rings / 2000 accounts for a meaningful test).
- **Graph + features**: `detection/graph_queries.py`, `detection/features.py`
  (13-dim component vector), `detection/temporal.py`.
- **ML scoring**: RandomForest trained on **easy + hard** rings. XGBoost also
  trained (fixed `scale_pos_weight`); RF wins on validation AUC.
- **Explainability**: `detection/explain.py` + SHAP global importance in the
  training report. Each flag traces to shared device/IP, signup window, or
  referral cycle.
- **Honest evaluation** (`detection/train.py`, `evaluation/evaluate.py`):
  reports on **two independent held-out sets**, never tuned on the test.

### Real services (priority 2) — VERIFIED via `docker compose up`
- `docker compose up --build` boots **all 4 containers healthy**: postgres,
  neo4j, api, web. `/health` reports `postgres: true, neo4j: true`.
- `docker-compose.yml` — Postgres 16, Neo4j 5, FastAPI (api), React (web).
- `Dockerfile` + `docker-entrypoint.sh` — api container self-bootstraps
  (generate data → train model → load initial batch → serve).
- `loader/load.py` — single idempotent ingestion path into Postgres + Neo4j
  (CSV → `ON CONFLICT DO NOTHING` / Cypher `MERGE`); used by `/ingest` too.
  Load observed: neo4j 500 accounts / 500 device edges / 500 ip edges /
  367 referral edges / 500 payments; re-run added 0 Postgres rows (idempotent).
- `tests/test_loader.py` — proves `load_batch` is idempotent using in-memory
  fakes (Postgres +0 new rows on re-run, no duplicate Neo4j edges); needs no
  running DB, so the property is unit-testable on its own.
- `api/` — `/health`, `/rings`, `/rings/{id}`, `/rings/{id}/subgraph`,
  `/evaluate`, `/ingest`. Verified live: `/rings` returns flagged rings,
  `/rings/{id}/subgraph` returns 30 nodes / 156 edges **from Neo4j**,
  `/evaluate` returns P=1.0/R=1.0 on the held-out test.
- Dashboard `web` serves at :5173 and its `/api` proxy returns live rings.
- **Dashboard fully wired to the live API and browser-verified** (headless
  Chromium click-through): Home KPIs pull `Precision`/`Recall`/`F1` + FP rate
  from `/evaluate` (held-out test) and live ring/account counts from `/rings`;
  the ring detail screen renders the real `explanation`, Cytoscape subgraph
  (`/rings/{id}/subgraph`), shared devices/IPs (`shared_entities`), 30 members,
  and fragment sub-scores. `MetricsScreen` shows the real confusion matrix and
  held-out rows.

**Three real bugs found and fixed during the dashboard click-through**
(only surfaced once the UI was actually rendered against the API):
1. `dashboard/src/screens/RingDetailScreen.jsx`, `DashboardScreen.jsx`,
   `MetricsScreen.jsx` were **hardcoded to `mock.js`** — the detail view, home
   KPIs, and metrics were fabricated, not from the API. Rewired all three to
   `fetchMetrics` / `fetchRings` / `fetchRing` / `fetchSubgraph`. The mock
   dashboard would have failed the "live audit trail" deliverable and the
   project's honesty mandate.
2. `dashboard/package.json` was **missing `react-cytoscapejs` and
   `cytoscape-dagre`** even though the detail screen imported them — the
   subgraph would crash at runtime. Added both dependencies (and installed).
3. `api/rings_service.py` re-ran the full heavy `run_detection` on **every**
   `/rings/{id}` and `/rings/{id}/subgraph` call (no caching) → the detail hung
   for minutes. Added a per-data-dir detection cache (fresh deep-copy per call
   so callers can't corrupt it) and `clear_detection_cache()` on `/ingest`.
4. `api/neo4j_queries.py` referral-cycle query used an **unbounded**
   variable-length path `[:REFERRED*1..]-(a)` — exponential blow-up (≥2³⁰ paths)
   that hung the `/rings/{id}` `shared_entities` call indefinitely. Replaced it
   with a cheap member-only referral-edge fetch + in-Python cycle detection.
5. `AuditTrailScreen` and `IngestionScreen` were still **hardcoded to mock/fake
   data** (the audit screen had no backend source at all). Added a real
   `GET /audit` endpoint (detection-run + per-ring events with the real
   `explanation` summary, so each entry is traceable to why it was flagged) and
   rewired the audit screen to it (with a "View ring" drill-down). Rewired
   `IngestionScreen` to actually `POST` the batch to `/ingest` and render the
   real `ring_count` / loaded-row response. Both browser-verified: the audit
   trail shows 5 real events (1 run + 4 rings) and a real `.zip` ingest returned
   "4 Rings Detected" with the loaded-row breakdown, zero console errors.

**Two earlier bugs found and fixed during Docker verification** (neither would
have shown up in CSV-backed smoke tests):
1. `loader/load.py` — Neo4j referral `MERGE` pattern included a null
   `ring_id` property (normal referrals have none) → Neo4j rejected it.
   Fixed by merging on `batch` only and `SET`-ing the nullable fields.
2. `api/db.py` — the function `_pg_pool()` shadowed the module variable
   `_pg_pool = None`, so Postgres was **never** reachable (always reported
   `postgres: false`). Renamed the function to `_get_pg_pool()` and fixed the
   two `putconn` call sites. After the fix, `/health` shows `postgres: true`.

---

## Honest held-out metrics (replaces stale ROADMAP Day 3 block)

Detection is a **graph-structure** problem, so accounts that share *no*
device/IP/referral with a co-conspirator form no cluster and are inherently
undetectable. We report overall and **detectable-cluster** recall (rings that
form a cluster of size ≥ 5).

| Set | Precision | Recall | Detectable-cluster recall | FP |
|-----|-----------|--------|---------------------------|----|
| Easy test (held-out, seed 137) | 1.000 | 1.000 | 1.000 | 0 |
| Hard test (held-out, frozen 30% slice) | 1.000 | 0.444 | 1.000 | 0 |

- Obvious rings: caught with **zero false positives**.
- Subtle "hard" rings fragment into small components (only 50% device / 40% IP
  overlap), so the few members that form **no** cluster are undetectable by
  construction — but **every hard ring that forms a real cluster is caught**.
- Rule-based baseline (for contrast): easy P≈0.05, hard P≈0.07 — floods review
  with false positives, which is why the ML model is primary.
- Full breakdown: `detection/model/training_report.json`.

---

## Not yet done
- Day 7: 5-minute pitch video, public repo push.
- `detection/` still reads from CSV in service mode rather than Neo4j directly
  — Neo4j is used for subgraph/shared-entity **enrichment only** (ROADMAP Day 5,
  the "read from Neo4j" item is intentionally left unchecked). Core detection
  runs on NetworkX regardless of whether Neo4j is up.

## Next recommended steps
1. Record pitch video (problem → architecture → live detection run → metrics →
   one graceful failure case).
2. Push to the public repo.

## Verified during the 2026-08-27 e2e pass (no Docker daemon available here)
- `tests/test_loader.py` added — proves load is idempotent (Postgres +0 new
  rows on re-run, Neo4j edge set does not grow). Uses in-memory fakes so it
  needs no running DB.
- `detection.train` reproduces frozen metrics (Easy P/R/F1=1.0 FP=0; Hard
  P=1.0 R=0.444, detectable-cluster R=1.0, FP=0).
- `detection.scoring` → `evaluation.evaluate` reproduces exact held-out numbers
  (account-level P/R/F1=1.0, 0 FP).
- API (`/health`, `/rings`, `/rings/{id}`, `/rings/{id}/subgraph`, `/audit`,
  `/evaluate`) all return 200 via `TestClient` (CSV fallback, no DBs).
- Dashboard `npm run build` succeeds (347 modules, incl. cytoscape). **Bug
  found + fixed:** `react-cytoscapejs` / `cytoscape-dagre` were declared in
  `package.json` but not installed in `node_modules` → build failed to resolve
  them. Ran `npm install` to pull them in. (The in-repo `dist/` is root-owned
  from an earlier Docker build and can't be overwritten without sudo; it's
  gitignored, so it doesn't affect the repo — build to a clean dir instead.)
- README now has the architecture diagram (PRD Section 6) + one-command
  `docker compose up` run instructions.
