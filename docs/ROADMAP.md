# Sentra — 1-Week Build Roadmap

**Deadline:** 7 days from project start
**Strategy:** Follow PRD Section 12 priority order strictly — core detection first, services second, dashboard last. Each day ends with something demoable if time runs out.

---

## Day 1 — Repo Scaffold + Synthetic Data Generator

**Goal:** Working generator that outputs labeled CSVs.

- [ ] Create full directory structure per PRD Section 13
- [ ] `docker-compose.yml` stub (Postgres + Neo4j services only, no API/dashboard yet)
- [ ] `data/generator/config.py` — ring size range, count, time-window params, seed
- [ ] `data/generator/generate.py` — generates ~500 accounts:
  - Normal accounts: organic signup spread, own devices/IPs, some legitimate overlap, sparse non-cyclic referrals, small transactions
  - Injects 2–3 rings (10–30 accounts each): tight signup window, shared device/IP, dense closed-loop referrals, one small transaction per account
  - Writes CSVs to `data/raw/` (accounts, devices, ips, payment_methods, transactions, referrals)
  - Writes `data/labels/ground_truth.json` (ring membership labels)
- [ ] Manually inspect CSVs — tune `config.py` until rings are "detectable but not too obvious"
- [ ] Verify normal accounts have some legitimate device/IP overlap (critical for honest false-positive cost)

**Deliverable:** Labeled CSVs + ground truth, inspectable and resettable.

---

## Day 2 — Detection Engine

**Goal:** Graph queries + scoring that flags rings offline, no DB needed.

- [ ] `detection/graph_queries.py` — build graph from CSVs (NetworkX):
  - Connected components on shared device/IP/referral edges
  - Detect referral cycles within components
  - Compute component density, size
- [ ] `detection/temporal.py` — signup-time clustering score per component
- [ ] `detection/scoring.py` — combine structural + temporal + cycle signals into ring score (rule-based weights)
- [ ] `detection/explain.py` — for each flagged ring, output: shared devices/IPs, referral subgraph, signup time window
- [ ] Run detection against generated CSVs, eyeball output — are the right clusters flagged? Are legitimate overlaps not flagged?

**Deliverable:** Offline detection pipeline that reads CSVs and outputs scored, explained rings.

---

## Day 3 — Evaluation + Held-Out Metrics

**Goal:** Honest precision/recall/F1 on a held-out test set.

- [ ] `evaluation/split.py` — split labeled data into dev (80%) and held-out test (20%) at the ring level
- [ ] `evaluation/evaluate.py` — compute:
  - Ring-level precision, recall, F1
  - Account-level precision, recall, F1
  - False-positive cost: count legitimate accounts with shared-wifi overlap swept into flagged rings
- [ ] Tune detection thresholds on dev split only
- [ ] Run final evaluation on test split — **freeze these numbers**
- [ ] Document the metrics (even a rough table in notes)

**Deliverable:** Frozen precision/recall/F1 + false-positive cost on held-out test. This is the core deliverable the track grades.

---

## Day 4 — Infrastructure + Loader

**Goal:** Docker Compose up with Postgres + Neo4j, data loaded.

- [ ] Finalize `docker-compose.yml` — Postgres, Neo4j, API (FastAPI), dashboard (React dev server or static build)
- [ ] `loader/load.py` — reads CSVs, loads into:
  - Postgres: accounts, transactions, KYC status
  - Neo4j: account↔device, account↔IP, referral edges (Cypher `MERGE` for idempotency)
  - Must be re-runnable without double-inserting (idempotent)
- [ ] `api/db.py` — Postgres + Neo4j connection setup
- [ ] Test: `docker compose up`, run loader, verify data in both databases
- [ ] Write `tests/test_loader.py` — loader idempotency test (run twice, verify no duplicates)

**Deliverable:** Full infra running, data in both stores, loader proven idempotent.

---

## Day 5 — API Layer

**Goal:** FastAPI serving detection results.

- [ ] `api/main.py` — FastAPI app setup
- [ ] `api/routes/rings.py`:
  - `GET /rings` — list all flagged rings with scores, sizes, status
  - `GET /rings/{ring_id}` — detailed ring: members, shared entities, explanation
- [ ] `api/routes/evaluate.py` — `GET /evaluate` — returns precision/recall/F1/cost from evaluation output
- [ ] `api/routes/ingest.py` — `POST /ingest` — accepts CSV upload → runs `loader/load.py` → re-runs detection → returns updated ring list
- [ ] Update `detection/` to read from Neo4j (Cypher queries via `graph_queries.py`) instead of CSVs when running in service mode
- [ ] Test all endpoints manually via curl or browser

**Deliverable:** Working API with all 4 endpoints, detection powered by graph DB.

---

## Day 6 — Dashboard (React + Tailwind)

**Goal:** Minimal working UI — three screens + ingest button.

- [ ] `dashboard/` — React app setup (Vite + React + Tailwind + Cytoscape.js)
- [ ] `dashboard/src/RingList.jsx` — ranked table of flagged rings (score, size, status), fetches from `/rings`
- [ ] `dashboard/src/SubgraphView.jsx` — Cytoscape.js graph: accounts as nodes, shared device/IP/referral as edges, fed from `/rings/{id}` response
- [ ] `dashboard/src/ExplanationPanel.jsx` — plain-language reason (shared device, signup window, referral cycle) for selected ring
- [ ] `dashboard/src/IngestButton.jsx` — file upload → calls `/ingest` → refreshes ring list
- [ ] Wire dashboard into `docker-compose.yml`
- [ ] End-to-end test: upload CSV via dashboard → see rings appear → click ring → see subgraph + explanation

**Deliverable:** Working dashboard, full stack end-to-end via `docker compose up`.

---

## Day 7 — Integration, Polish + Deliverables

**Goal:** Demo-ready. Pitch video. Architecture diagram. Repo polished.

- [ ] Full end-to-end run: generate data → load → detect → API → dashboard → explain
- [ ] Fix any integration bugs surfaced by end-to-end run
- [ ] `README.md` — architecture diagram (from PRD Section 6), one-command run instructions (`docker compose up`)
- [ ] Record 5-minute pitch video: problem → architecture → live detection run → metrics → one failure case handled gracefully
- [ ] Audit trail: demonstrate clicking a ring and seeing why it was flagged
- [ ] Clean up: remove debug prints, ensure `.gitignore` covers `data/raw/`, `.env` files, `node_modules/`
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
