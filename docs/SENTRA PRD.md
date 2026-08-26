# Sentra — Product Requirements Document

**Track:** Razorpay AI Buildathon, Track 02 — AI Risk Manager ("Abuse-ring sentinel" is a named example direction, so this is squarely on-track)
**One-liner:** Sentra detects coordinated fraud rings (referral/signup abuse) hiding inside otherwise-normal account, device, and transaction data, and explains *why* it flagged each ring.

---

## 1. Problem Statement

Referral and signup-bonus abuse is a coordinated crime, not a single bad transaction. A ring of 10–30 fake or mule accounts, sharing devices/IPs, signing up in a tight time window, forming a dense closed-loop referral chain, and each making one small "legitimate-looking" transaction — is invisible to any detector that scores accounts or transactions one at a time. It only becomes visible as a *graph pattern*: unusual density and structure in how entities connect to each other.

Sentra's job is to surface that structure, score it, and explain it — without drowning the risk team in false positives.

## 2. Track Bar (what we are graded against)

Per the buildathon track requirements, we treat these as hard requirements, not nice-to-haves:
- A **working detector** for one class of loss (abuse rings), not a demo of an idea.
- **Measured precision and recall on a held-out test set** — not accuracy on the same data we tuned on.
- **Honest metrics including false-positive cost** — we must be able to say "flagging this ring costs the business X in review effort / false accusation risk."
- **Strictly defense-only.** Nothing in Sentra simulates, generates, or teaches ring construction beyond what's needed to build a labeled test set. No offense-capable output.
- Deliverables: **public repo, 5-minute pitch video, architecture diagram**, with an audit trail of what was flagged and why.

## 3. Goals

1. Detect injected fraud rings in synthetic data with high recall and acceptable precision, measured honestly on a held-out split.
2. Make every flag explainable: which shared device/IP, which referral subgraph, which timing anomaly triggered it.
3. Ship a real (if minimal) service architecture — not just a notebook — so the graph store, transactional store, and detection logic are separated the way they'd be in production.
4. Stay demoable at every stage: if we run out of time, whatever's done still runs end-to-end on a smaller scope.
5. Support re-running detection on new batches of data, not just the one fixed synthetic dataset — the detection engine already queries the graph fresh each time, so this is a matter of a real ingestion path, not a redesign.

## 4. Non-Goals (explicitly out of scope)

- Real payment data or real Razorpay integration — synthetic data only.
- Detecting fraud types other than coordinated rings (single-transaction fraud, card testing, etc.) — one class of loss, done well, per the track's own bar.
- Any generation of "how to build an undetectable ring" guidance as a product feature — ring injection exists only to create labeled ground truth for evaluation, and stays confined to the offline dataset generator.
- Real-time / streaming incremental detection — new accounts arriving continuously with the graph updating live, and detection logic that works on partial (still-forming) rings, is a meaningfully different system (event ingestion, incremental graph updates, partial-cluster scoring). It doesn't help against the track's own bar, which asks for measured precision/recall on a held-out batch, not live streaming. Explicitly a future direction, not something we build or mock for the demo.
- A polished production UI — a minimal dashboard to show flagged rings is enough; the demo video carries the polish.
- Production-grade security (auth, RBAC, WAF, penetration testing) — basic secrets hygiene only, per Section 13.

## 5. Users

- **Primary (in the demo):** a fraud/risk analyst who receives a ranked list of suspected rings, each with a subgraph visualization and a plain-language reason.
- **Primary (in the grading):** the buildathon judges — who need to see measured precision/recall, an architecture diagram, and a working repo in 5 minutes.

## 6. System Architecture

```
┌─────────────────┐        ┌───────────────────────────┐
│  Data Generator  │        │  New batch (any later CSV │
│  (synthetic,      │        │  of accounts/devices/     │
│  initial dataset) │        │  transactions/referrals)  │
└────────┬─────────┘        └────────────┬───────────────┘
         │                                │
         │  loader script (same path for both: initial load
         │  and any later re-run on a new batch)
         ▼                                ▼
┌─────────────────────────────┬───────────────────────────┐
│         Postgres            │           Neo4j            │
│  transactional source of    │  graph of accounts↔device,  │
│  truth: accounts,           │  accounts↔ip,               │
│  transactions, KYC status   │  accounts↔referral          │
└──────────────┬───────────────┴──────────────┬─────────────┘
               │                               │
               ▼                               ▼
        ┌───────────────────────────────────────────┐
        │           Detection Engine                  │
        │  - graph queries: connected components on   │
        │    shared device/IP, referral cycle density  │
        │  - temporal features: signup clustering      │
        │  - scoring: rule + simple ML combination     │
        └───────────────────┬───────────────────────┘
                             ▼
                  ┌────────────────────────────────┐
                  │   API layer (FastAPI)            │
                  │  /rings, /rings/{id}, /evaluate,  │
                  │  /ingest (POST new batch → loader │
                  │  → detection re-run)              │
                  └───────────┬────────────────────────┘
                              ▼
                  ┌───────────────────────────┐
                  │  Minimal dashboard          │
                  │  - ranked ring list          │
                  │  - subgraph view (Cytoscape.js) │
                  │  - explanation panel          │
                  │  - "upload/ingest batch" button │
                  │    → calls /ingest              │
                  └───────────────────────────┘
```

All components run via **Docker Compose** (Postgres, Neo4j, API, dashboard) so the whole stack comes up with one command — this doubles as the "architecture" deliverable.

**Re-running on new batches:** the loader script is written once and used for both the initial dataset load and any later batch — dropping in a new CSV and calling `/ingest` (via API directly, or the dashboard's upload button, which just calls the same endpoint) re-runs the same loader and detection pipeline against the new data. No separate code path, no redesign — this is a direct consequence of having split ingestion, storage, and detection from day one.

## 7. Data Model

| Entity | Fields |
|---|---|
| Account | `account_id`, `signup_time`, `kyc_status` |
| Device | `device_id` (many accounts may share one) |
| IP | `ip_address` (many accounts may share one) |
| Payment method | masked card BIN or UPI handle |
| Transaction | `transaction_id`, `account_id`, `amount`, `timestamp` |
| Referral | `referrer_id` → `referred_id` |

Postgres holds the row-level truth (accounts, transactions, KYC). Neo4j holds the relationship layer (account–device, account–ip, referral edges) since ring structure is fundamentally a graph question — connected components, cycles, density — that's slow and awkward in SQL and natural in Cypher.

## 8. Synthetic Dataset Spec

**Scale:** ~500 accounts, 2–3 injected rings, 10–30 accounts each (locked decision).

**Normal accounts:**
- Steady, organic signup rate over the full time window.
- Each account has its own device/IP, with some legitimate overlap (shared wifi/family devices) built in on purpose — a detector that flags every shared IP is trivially fooled and would fail the honest false-positive-cost requirement.
- Referral chains sparse, spread over time, no cycles.

**Injected rings:**
- Cluster of 10–30 accounts.
- Signups clustered in a tight window (minutes to a couple hours).
- Shared `device_id` and/or `ip_address` across most of the cluster.
- Dense, closed-loop referral chain within the cluster (structurally distinct from organic spread-out referrals).
- Each account makes one small, otherwise-unremarkable transaction — specifically to defeat any detector that only looks at single transactions.

**Generation approach (locked decision):** Python generator → CSV first. Reasoning: field design and ring realism ("detectable but not too obvious") need to be iterated on and eyeballed before adding database plumbing on top — debugging data logic and DB connections at the same time is slower. A separate loader script then reads the CSVs into Postgres/Neo4j once the infra is up. This also makes the CSV a reusable, resettable test fixture.

**Held-out split:** dataset is generated with ring membership labeled internally. Before any detector tuning, we split into a dev set (visible, used to tune thresholds) and a held-out test set (touched only for final metrics) — this is what makes the precision/recall numbers honest rather than self-graded.

## 9. Detection Approach

1. **Structural signal:** connected-components / community detection on the account graph (edges = shared device, shared IP, referral link). Rings show up as unusually dense, small, tightly-connected subgraphs.
2. **Temporal signal:** signup-time clustering within a candidate component (tight window = suspicious).
3. **Cycle signal:** closed-loop referral structure within a component (organic referral trees don't cycle back).
4. **Transaction camouflage check:** confirm the "one small legitimate-looking transaction per account" pattern doesn't already get caught by naive per-transaction rules, and show that Sentra catches it via structure instead.
5. **Scoring:** combine the above into a ring score (start rule-based/weighted for explainability and speed to build; a simple ML classifier on component-level features is the stretch upgrade if time allows).
6. **Explainability:** every flagged ring returns the specific shared device/IP, the referral subgraph, and the signup time window that triggered it — this is what turns a score into an audit trail.

## 10. Evaluation Plan

- **Metrics:** precision, recall, F1 on the held-out test set, at the ring level (did we correctly flag the injected ring as a unit) and at the account level (did we correctly flag its members).
- **False-positive cost:** report how many legitimate accounts with shared-wifi/family-device overlap get incorrectly swept into a flagged ring, and frame this as review-effort cost, not just a raw count.
- **Threshold tuning:** done only on the dev split; test split numbers reported once, unchanged.

## 11. Dashboard & UI Scope

Explicitly **demo-grade, not production-ready** — the track grades measured detection accuracy and architecture, not frontend polish, so effort here is deliberately capped.

**Three screens, no more:**
1. **Ranked ring list** — table of flagged rings (score, size, status), served straight off the `/rings` API.
2. **Subgraph view for a selected ring** — the actual graph (accounts as nodes, shared device/IP/referral as edges) rendered with **Cytoscape.js** (locked in), fed directly from Neo4j query output as nodes/edges JSON. This is the highest-leverage screen: seeing the dense cluster sells "this is structural, not guesswork" in seconds, for very little build effort since Cytoscape.js handles layout out of the box.
3. **Explanation panel** — click a ring, see the plain-language reason (shared device, signup window, referral cycle) — the audit trail made visible.

**Plus:** an "upload/ingest batch" button that calls `/ingest` (see Section 6) so a new CSV can be dropped in and re-scored from the dashboard, not just via API/CLI.

**Stack:** React + Tailwind for the shell — no auth, no real-time updates, no responsive/mobile design, no state management library. A read-only view over the latest detection run, plus the one ingest action.

**Explicitly out of scope for the dashboard:** live/streaming updates, filters/search beyond maybe one dropdown, anything hand-rolled for graph layout (use Cytoscape.js defaults).

## 12. Security

Minimal security hygiene — enough to not embarrass the repo, not enough to be a production system.

- **Secrets management:** all database credentials, API keys, and Neo4j connection strings live in a `.env` file at the repo root, loaded by Docker Compose. `.env` is `.gitignored`. An `.env.example` with placeholder values is committed so anyone can stand up the stack.
- **No secrets in code:** environment variables only, never hardcoded in Python, JavaScript, or YAML files.
- **Input validation:** FastAPI request models enforce expected types and ranges on `/ingest` uploads (file type, size limit). No raw user input flows into Cypher or SQL unsanitized.
- **Dependency audit:** run `pip-audit` (Python) and `npm audit` (dashboard) once before the final push to catch known CVEs in dependencies. Fix critical/high, note medium/low.
- **No auth:** explicitly out of scope — this is a single-user local demo, not a deployed service. Auth adds complexity that earns nothing against the track bar.

## 13. Error Tracking & Logging

Structured logging so that when something breaks during the demo or in front of judges, the failure is diagnosable in seconds, not minutes.

- **Python logging:** all backend components (`loader/`, `detection/`, `api/`, `evaluation/`) use Python's `logging` module with a consistent format: `[timestamp] [level] [component] message`. Log level defaults to `INFO` in Docker, overridable via env var.
- **API request logging:** FastAPI middleware logs every incoming request (method, path, status code, duration) — this is the first place to look when "the API isn't working" during a live demo.
- **Detection run logging:** `detection/scoring.py` logs each candidate component it evaluates and its score, so a missing or unexpected flag is traceable to the exact step.
- **Loader logging:** `loader/load.py` logs rows inserted per table and any skipped/duplicate rows — idempotency issues surface immediately.
- **Error responses:** FastAPI returns structured JSON error responses (`{"error": "...", "detail": "..."}`) for all failure modes (bad input, DB connection failure, loader crash), not raw 500s.
- **No external services:** no Sentry, Datadog, or third-party error tracking — Python `logging` to stdout (captured by Docker) is sufficient at this scale.

## 14. Build Priority Order (demoable at every stage)

1. **Core detection logic** — generator → CSVs → graph queries → ring scoring, all runnable locally/offline, no services yet. This alone proves the idea and produces the precision/recall numbers.
2. **Wrap in real services** — Docker Compose with Postgres + Neo4j, loader script, FastAPI layer exposing `/rings`.
3. **Extras** — minimal dashboard/subgraph visualization, ML scoring upgrade, polish for the pitch video.

Daily course-correction: if a day runs long, whatever's furthest along in this order is still a complete, demoable slice.

## 15. Repository Scaffolding

The folder structure mirrors the priority order and evaluation requirements above — every piece exists because something earlier in this document requires it, not by default project convention.

```
sentra/
├── .env                       # DB credentials, Neo4j URI — gitignored, never committed
├── .env.example               # placeholder values so anyone can stand up the stack
├── .gitignore                 # data/raw/, .env, node_modules/, __pycache__/, etc.
├── docker-compose.yml         # Postgres + Neo4j + API + dashboard, one command to stand up
│                              #   the whole stack — this IS the "architecture" deliverable running
│
├── data/
│   ├── generator/
│   │   ├── generate.py        # writes normal accounts + injects 2-3 rings → CSVs
│   │   └── config.py          # ring size, count, time-window params — kept separate so we can
│   │                          #   tune "detectable but not too obvious" without touching logic
│   ├── raw/                   # generator output CSVs (gitignored, regenerable — never hand-edited)
│   └── labels/
│       └── ground_truth.json  # ring membership labels, kept OUT of raw/ on purpose —
│                              #   this is what makes the dev/held-out split possible and honest
│
├── loader/
│   └── load.py                # CSV → Postgres/Neo4j. Same script for initial load AND
│                              #   /ingest re-runs — this is what makes "re-runnable on new
│                              #   batches" true without a second code path
│
├── detection/
│   ├── graph_queries.py       # Cypher: connected components, referral cycles, shared device/IP
│   ├── temporal.py            # signup-clustering scoring
│   ├── scoring.py             # combines signals into a ring score — isolated from the API
│   │                          #   layer so it's directly unit-testable against ground_truth.json
│   └── explain.py             # turns a flagged ring into the plain-language reason —
│                              #   this file exists because "explainability" is a named
│                              #   requirement, not an afterthought bolted onto the API
│
├── evaluation/
│   ├── split.py               # dev/test split logic — lives outside detection/ so it can
│   │                          #   never accidentally be touched by tuning code
│   └── evaluate.py            # precision/recall/F1 + false-positive cost, run ONLY against
│                              #   test split — produces the numbers the track actually grades
│
├── api/
│   ├── main.py                # FastAPI app, logging config, request middleware
│   ├── routes/
│   │   ├── rings.py           # /rings, /rings/{id}
│   │   ├── ingest.py          # /ingest — calls loader/load.py then detection/, backs
│   │   │                      #   both the CLI/API path and the dashboard's upload button
│   │   └── evaluate.py        # /evaluate — exposes evaluation/evaluate.py's output
│   └── db.py                  # Postgres + Neo4j connection setup, shared by all routes
│
├── dashboard/
│   ├── src/
│   │   ├── RingList.jsx       # screen 1
│   │   ├── SubgraphView.jsx   # screen 2 — Cytoscape.js, fed nodes/edges JSON straight
│   │   │                      #   off a graph_queries.py result, no transform layer needed
│   │   ├── ExplanationPanel.jsx # screen 3 — renders explain.py's output directly
│   │   └── IngestButton.jsx   # calls /ingest — the one write action the UI has
│   └── package.json
│
├── tests/
│   ├── test_detection.py      # detection logic against ground_truth.json — this is what
│   │                          #   proves the metrics in the PRD aren't accidental
│   └── test_loader.py         # loader idempotency — since it's reused for re-runs,
│                              #   it has to not double-insert or corrupt state
│
└── README.md                  # architecture diagram (from PRD) + one-command run instructions
                                #   — this is what a judge reads in the first 30 seconds
```

**Deliberately excluded:** no `auth/`, `middleware/`, `migrations/` framework, or `k8s/` folder — none of that earns anything against the track's bar and would just be time spent not improving precision/recall.

**One structural rule worth flagging:** `detection/` has zero dependency on `api/`, and `evaluation/` has zero dependency on `detection/`'s tuning path — that separation is what keeps the held-out test numbers trustworthy rather than something dev-set tuning could leak into.

## 16. Deliverables Checklist

- [ ] Public repo (generator, loader, detection engine, API, docker-compose.yml)
- [ ] Architecture diagram (this document's Section 6, cleaned up)
- [ ] Precision/recall/false-positive-cost numbers on a held-out test set
- [ ] 5-minute pitch video: problem → architecture → live detection run → metrics → one failure case handled gracefully
- [ ] Audit trail shown live in the demo (why each ring was flagged)

## 17. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Synthetic rings too obvious → inflated metrics that don't mean anything | Built-in legitimate device/IP overlap for normal accounts; held-out test split |
| Time runs out before services layer | Priority order above — core detection alone is a valid demo |
| Graph queries slow at scale | 500 accounts is small; not a real concern at this scale, revisit only if we grow the dataset |
| Judges read this as offense-capable (ring construction) | Frame and keep the generator strictly as an internal eval-data tool, never exposed as a product feature; pitch video emphasizes detection, not generation |
