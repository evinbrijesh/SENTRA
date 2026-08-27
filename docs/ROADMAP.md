# Sentra — 1-Week Build Roadmap

**Deadline:** 7 days from project start
**Strategy:** Follow PRD Section 12 priority order strictly — core detection first, services second, dashboard last. Each day ends with something demoable if time runs out.

> Running status (with honest metrics) is tracked in [`PROGRESS.md`](./PROGRESS.md).
> The "Day 3 results (frozen)" block below has been corrected — earlier inflated
> numbers are replaced with dual held-out results.

---

## Day 1 — Repo Scaffold + Synthetic Data Generator

**Goal:** Working generator that outputs labeled CSVs.

- [x] Create full directory structure per PRD Section 13
- [x] `docker-compose.yml` stub (Postgres + Neo4j services only, no API/dashboard yet)
- [x] `data/generator/config.py` — ring size range, count, time-window params, seed
- [x] `data/generator/generate.py` — generates ~500 accounts:
  - Normal accounts: organic signup spread, own devices/IPs, some legitimate overlap, sparse non-cyclic referrals, small transactions
  - Injects 2–3 rings (10–30 accounts each): tight signup window, shared device/IP, dense closed-loop referrals, one small transaction per account
  - Writes CSVs to `data/raw/` (accounts, devices, ips, payment_methods, transactions, referrals)
  - Writes `data/labels/ground_truth.json` (ring membership labels)
- [x] Manually inspect CSVs — tune `config.py` until rings are "detectable but not too obvious"
- [x] Verify normal accounts have some legitimate device/IP overlap (critical for honest false-positive cost)

**Deliverable:** Labeled CSVs + ground truth, inspectable and resettable.

---

## Day 2 — Detection Engine

**Goal:** Graph queries + scoring that flags rings offline, no DB needed.

- [x] `detection/graph_queries.py` — build graph from CSVs (NetworkX):
  - Connected components on shared device/IP/referral edges
  - Detect referral cycles within components
  - Compute component density, size
- [x] `detection/temporal.py` — signup-time clustering score per component
- [x] `detection/scoring.py` — combine structural + temporal + cycle signals into ring score (rule-based weights)
  - Includes `__main__` entry point: `python -m detection.scoring --data-dir data/raw/ --output data/output/flagged_rings.json`
  - Three-way classification: `flagged` (auto), `needs_review` (borderline), `clean`
- [x] `detection/explain.py` — for each flagged ring, output: shared devices/IPs, referral subgraph, signup time window
- [x] Run detection against generated CSVs, eyeball output — are the right clusters flagged? Are legitimate overlaps not flagged?

**Deliverable:** Offline detection pipeline that reads CSVs and outputs scored, explained rings.

---

## Day 3 — Evaluation + Held-Out Metrics

**Goal:** Honest precision/recall/F1 on a held-out test set.

- [x] `evaluation/split.py` — split labeled data into dev (80%) and held-out test (20%) at the ring level
- [x] `evaluation/evaluate.py` — compute:
  - Ring-level precision, recall, F1
  - Account-level precision, recall, F1
  - False-positive cost: count legitimate accounts with shared-wifi overlap swept into flagged rings
- [x] Tune detection thresholds on dev split only
- [x] Run final evaluation on test split — **freeze these numbers**
- [x] Document the metrics (even a rough table in notes)

**Deliverable:** Frozen precision/recall/F1 + false-positive cost on held-out test. This is the core deliverable the track grades.

### Day 3 results (honest, dual held-out)

> ⚠️ The numbers below **replace** an earlier inflated "Hard R=0.71 → 0.93" claim.
> That figure predated training on subtle rings and was misleading. See `docs/PROGRESS.md`.

Model: **RandomForest** (trained on easy + hard rings; XGBoost underfits this
small/imbalanced set, validation AUC 0.48 vs 0.84, so RF is primary).

| Set | Precision | Recall | Detectable-cluster recall* | FP |
|-----|-----------|--------|---------------------------|----|
| Easy test (held-out, seed 137) | 1.000 | 1.000 | 1.000 | 0 |
| Hard test (held-out, frozen 30% slice) | 1.000 | 0.444 | 1.000 | 0 |

\* Detectable-cluster recall counts only rings that form a graph cluster of
size ≥ 5. The 5 hard "misses" are ring members that share no device/IP/referral
with any co-conspirator and therefore form no cluster — inherently undetectable
by a graph-structural detector (the project's stated scope). Every hard ring
that forms a real cluster is caught (detectable-cluster R=1.0, 0 FP).

Rule-based baseline contrast (why ML is primary): easy P≈0.05 / hard P≈0.07
with 55–71 false positives — it floods review with noise.

Bonus: `needs_review` routing bucket (score band below the auto-flag threshold)
catches borderline candidates without lowering the auto-flag bar.

---

## Day 4 — Infrastructure + Loader

**Goal:** Docker Compose up with Postgres + Neo4j, data loaded.

- [x] `docker-compose.yml` — Postgres, Neo4j, API (FastAPI), dashboard (React dev server). Updated 2026-08-27 (was a stub).
- [x] `loader/load.py` — reads CSVs, loads into:
  - Postgres: accounts, transactions, KYC status
  - Neo4j: account↔device, account↔IP, referral edges (Cypher `MERGE` for idempotency)
  - Idempotent (ON CONFLICT DO NOTHING / MERGE) and re-runnable
- [x] `api/db.py` — Postgres + Neo4j connection setup (lazy, degrades gracefully)
- [x] Test: `docker compose up --build` — verified 2026-08-27: all 4 containers healthy, loader populated Postgres + Neo4j (two loader/DB bugs found & fixed: null `ring_id` in Neo4j `MERGE`; `_pg_pool` name collision in `api/db.py`)
- [x] Write `tests/test_loader.py` — loader idempotency test (run twice, verify no duplicates)

**Deliverable:** Full infra running, data in both stores, loader proven idempotent.

---

## Day 5 — API Layer

**Goal:** FastAPI serving detection results.

- [x] `api/main.py` — FastAPI app setup (CORS, request logging, health)
- [x] `api/routes/rings.py`:
  - `GET /rings` — list all flagged rings with scores, sizes, status
  - `GET /rings/{ring_id}` — detailed ring: members, shared entities, explanation
  - `GET /rings/{ring_id}/subgraph` — Cytoscape nodes/edges (Neo4j if up, else CSV fallback)
- [x] `api/routes/evaluate.py` — `GET /evaluate` — returns precision/recall/F1/cost from held-out eval
- [x] `api/routes/ingest.py` — `POST /ingest` — accepts CSV upload → runs `loader/load.py` → re-runs detection
- [x] `api/routes/audit.py` — `GET /audit` — real detection-run + per-ring audit events (with explanation summaries) for the live audit trail
- [ ] Update `detection/` to read from Neo4j (Cypher queries via `graph_queries.py`) instead of CSVs when running in service mode (currently CSV-backed, Neo4j used for subgraph/shared-entity enrichment)
- [x] Test all endpoints — smoke-tested via TestClient (CSV-backed): all return 200

**Deliverable:** Working API with all endpoints, serving NetworkX-based detection results; Neo4j powers the `/rings/{id}/subgraph` enrichment.

---

## Day 6 — Dashboard (React + Tailwind)

**Goal:** Minimal working UI — three screens + ingest button.

- [x] `dashboard/` — React app setup (Vite + React + Tailwind + Cytoscape.js)
- [x] `dashboard/src/` — RingList, SubgraphView, ExplanationPanel, IngestButton, screens (Dashboard, RingDetail, AuditTrail, Metrics, Ingestion)
- [x] Wire dashboard into `docker-compose.yml` (web service, proxies `/api` → `api:8000`, target overridable via `VITE_API_TARGET`)
- [x] End-to-end click-through verified live (headless Chromium, 2026-08-27): Dashboard KPIs, RingList, RingDetail (explanation + Cytoscape subgraph + shared entities + fragment scores), and Metrics all render from the **real** API. Three screens had been hardcoded to `mock.js` and were rewired to `fetchMetrics`/`fetchRings`/`fetchRing`/`fetchSubgraph`; added missing `react-cytoscapejs`/`cytoscape-dagre` deps; fixed two backend perf bugs that hung the detail view (`run_detection` caching in `rings_service`, and an exponential Neo4j referral-cycle query in `neo4j_queries`). See `PROGRESS.md`.

---

## Day 7 — Integration, Polish + Deliverables

**Goal:** Demo-ready. Pitch video. Architecture diagram. Repo polished.

- [x] Full end-to-end run: generate data → load → detect → API → dashboard → explain
- [x] Fix any integration bugs surfaced by end-to-end run
- [x] `README.md` — architecture diagram (from PRD Section 6), one-command run instructions (`docker compose up`)
- [ ] Record 5-minute pitch video: problem → architecture → live detection run → metrics → one failure case handled gracefully
- [x] Audit trail: demonstrate clicking a ring and seeing why it was flagged (RingDetail now serves the real `explanation` + subgraph from the API)
- [x] Clean up: remove debug prints (none stray — only legit CLI output), `.gitignore` already covers `data/raw/`, `.env`, `node_modules/`
- [ ] Push to public repo

**Deliverable:** Public repo, pitch video, architecture diagram, live audit trail — all grading deliverables met.

---

## Risk Buffer

If any day runs long, cut from the bottom:
- Day 7 polish can be trimmed (pitch video can be rough)
- Day 6 dashboard can be simplified (table-only, skip subgraph view)
- Day 5 API can skip `/ingest` endpoint (use CLI loader only)
- Day 3 ML scoring upgrade is a stretch goal, skip entirely

**The non-negotiable:** Days 1–3 must complete. Core detection + honest metrics on a held-out split is the minimum viable submission.
