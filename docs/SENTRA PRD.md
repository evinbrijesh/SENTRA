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

1. Detect injected fraud rings using a trained ML classifier (RandomForest / XGBoost) on graph-structural features, with high recall and acceptable precision measured honestly on a held-out split.
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
        │  - feature extraction: structural + temporal │
        │  - ML classifier: trained RandomForest/      │
        │    XGBoost on component-level features       │
        │  - explainability: feature importance + SHAP │
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

The detection engine uses a **trained ML classifier** (not rule-based heuristics) to score whether a connected component in the account graph is a fraud ring. This makes Sentra a genuine AI system: the model learns ring patterns from labeled synthetic data and generalizes to new, unseen components.

### 9.1 Pipeline Overview

```
CSVs → build graph → find connected components → extract features per component → ML classifier → flagged rings
                                                              ↑
                                                    trained offline via
                                                    detection/train.py
```

### 9.2 Graph Construction (`detection/graph_queries.py`)

Build an undirected graph from CSVs:
- **Nodes** = accounts (with signup_time, kyc_status attributes)
- **Edges** = shared device, shared IP, or referral link (edge attributes track *why* two accounts are connected — for explainability)
- A separate directed referral graph is preserved for cycle detection (undirected graph loses referral direction)

### 9.3 Feature Extraction (`detection/features.py`)

For each connected component, extract a fixed-width feature vector:

| Feature | Source | Description |
|---|---|---|
| `size` | graph | Number of accounts in component |
| `density` | graph | edges / max_possible_edges (0–1) |
| `unique_devices` | graph | Count of distinct devices |
| `unique_ips` | graph | Count of distinct IPs |
| `device_concentration` | derived | unique_devices / size (lower = more suspicious) |
| `ip_concentration` | derived | unique_ips / size (lower = more suspicious) |
| `shared_device_edges` | graph | Edges caused by shared device |
| `shared_ip_edges` | graph | Edges caused by shared IP |
| `referral_edges` | graph | Edges caused by referrals |
| `referral_density` | derived | referral_edges / max_possible_edges |
| `has_referral_cycle` | graph | Boolean — closed-loop referral chain exists |
| `temporal_score` | temporal | Signup time clustering (exponential decay, 0–1) |
| `burst_minutes` | temporal | Duration of signup window in minutes |

All features are numeric, no encoding needed. The feature vector is 13-dimensional.

### 9.4 Temporal Signal (`detection/temporal.py`)

Measures how tightly clustered signup times are within a candidate component:
- **Exponential decay** with configurable half-life (default 360 minutes)
- Accounts signing up within minutes score near 1.0; spread over days score near 0.0
- **Cluster-aware mode:** for contaminated components (ring + normal accounts pulled in via shared edges), scores only the dominant cluster (accounts sharing the most common device/IP) rather than all members

### 9.5 ML Classifier (`detection/train.py`)

**Models tested:** Both RandomForest and XGBoost are trained and compared. The model with higher AUC-ROC on the dev set is selected as the production classifier.

**Why tree-based models:**
- Native **feature importance** — every prediction is explainable by ranking which features contributed most
- **SHAP values** provide per-prediction breakdown of feature contributions (additive explanations)
- Work well with small datasets (~20–30 components from ~500 accounts)
- Fast training, no GPU required
- No feature scaling needed

**Training procedure:**
1. Load existing CSVs from the dev split (`data/raw/`)
2. Build graph, find components, extract features via `detection/features.py`
3. Label components using `data/labels/ground_truth_dev.json` (1 = ring if any member is a ground-truth ring member, 0 = legitimate) — **this is component-level labeling, not just the 3 ring membership entries**; every connected component (ring or not) in the graph is a training example, giving us far more than "3 labeled rings" to learn from
4. Split at **component level** (80/20 stratified, not account level) to prevent data leakage
5. Train both RandomForest and XGBoost on the train portion with simple grid search:
    - RandomForest: `n_estimators` [100, 200, 500], `max_depth` [5, 10, 20, None], `min_samples_split` [2, 5, 10]
    - XGBoost: `n_estimators` [100, 200], `max_depth` [3, 5, 7], `learning_rate` [0.01, 0.1, 0.2]
6. Evaluate both on the held-out portion of the dev split, select winner by AUC-ROC
7. Save winning model to `detection/model/ring_classifier.joblib`
8. **Evaluate on the held-out test split** (`data/raw_test/`) the same way, reporting precision/recall/F1/AUC against `data/labels/ground_truth_test.json`

**Inference:** `detection/scoring.py` loads the trained model and calls `model.predict_proba()` on feature vectors. The positive class probability becomes the ring score (0.0–1.0). The model has learned the weights from data — not hand-set.

**Honest dataset-size caveat:** With ~20–30 components per split (3 rings + a handful of legitimate clusters), the model is trained on a genuinely small sample. The synthetic generator gives us ground truth, but the learned decision boundary is only as good as that sample. This is reported honestly in the pitch video: "trained on N labeled clusters; with more production data this would generalize further." Tree models are chosen precisely because they handle small data without the overfitting risk of deep learning.

### 9.6 Explainability (`detection/explain.py`)

Every flagged ring must answer "why was this flagged?" — this is a first-class requirement, not an afterthought.

**Three layers of explainability:**

1. **Feature importance ranking** — which signals contributed most to the score (e.g., "device_concentration was the #1 factor at 0.35 contribution"). Computed from the trained model's native feature importances.
2. **SHAP values** — per-prediction additive explanation showing exactly how each feature pushed the score up or down from the baseline. Implemented via `shap.TreeExplainer` for the RandomForest/XGBoost model. For each flagged ring, `explain.py` returns a `shap_values` dict mapping each feature name to its SHAP contribution (positive = pushed toward "ring", negative = pushed toward "legitimate"). These feed directly into the dashboard's explanation panel.
3. **Plain-language reasons** — human-readable audit trail:
    - Shared device/IP details (which devices, how many accounts)
    - Signup time window (burst_start → burst_end, duration in minutes)
    - Referral cycle presence
    - Referral density compared to organic patterns

**SHAP is loaded lazily** in `explain.py` — if the `shap` package or the trained model is not installed, the module degrades gracefully (plain-language reasons still work, SHAP values are simply omitted from the output). This keeps the detection engine's zero-dependency guarantee for `api/` while still providing model interpretability when available.

### 9.7 Baseline Comparison

The rule-based scoring (weighted heuristic in `detection/scoring.py`) is retained as a baseline for comparison:
- Same features, same dev/test split
- Compared on precision, recall, F1, and AUC-ROC
- The ML model is **primary**: `detect_rings(use_ml=True)` (default) uses the trained classifier's probability as the ring score. The rule-based score is computed alongside as a sub-score breakdown for explainability and as a fallback if the model is unavailable (`use_ml=False`).
- Results are reported in the evaluation output

### 9.8 Scoring & Flagging

**Primary path (ML):** A component is flagged as a suspected ring if:
- ML model's positive class probability (the learned decision boundary) >= threshold (tuned on dev split), **AND**
- Either temporal score >= 0.30 (signup burst present) **OR** referral cycle detected (strong independent signal)

The temporal gate prevents false-positive clusters of normal accounts that share a device/IP (e.g., family wifi) but have no signup burst. The referral cycle bypass exists because organic referral trees never cycle back — a cycle is a strong independent signal regardless of other features.

**Calibrated review bucket:** Because the ML model outputs a calibrated probability (not just a label), the `needs_review` bucket becomes principled: candidates with probability in a mid-band (e.g., 0.4–0.6) are routed to human review rather than being silently passed or failed by an arbitrary margin around a hand-picked threshold. This is a direct benefit of using a learned probability instead of a fixed rule.

**Fallback path (rule-based):** If the trained model is not available, `detect_rings(use_ml=False)` falls back to the weighted rule-based score (Section 9.7 baseline) with the same temporal gate and review-band logic.

## 10. Evaluation Plan

### 10.1 Core Metrics (reported on held-out test set)

- **Precision, Recall, F1** — at both the ring level (did we correctly flag the injected ring as a unit) and the account level (did we correctly flag its members).
- **AUC-ROC** — threshold-independent measure of model separation between ring and legitimate components. More informative than precision/recall alone for comparing models.
- **Confusion matrix** — TP, FP, FN, TN counts at the component level. Makes false-positive and false-negative costs tangible.

### 10.2 Model Comparison

Both RandomForest and XGBoost were trained. On this dataset **RandomForest wins** (validation AUC 0.84 vs XGBoost 0.48 — XGBoost underfits the small, imbalanced positive set), so RandomForest is the primary model and XGBoost is retained only as a comparison point. All numbers below are on **held-out** sets the detector was never tuned on. We report on two independent held-out sets because the "easy" set is trivially separable and would otherwise hide real weaknesses:

| Set | Model | Precision | Recall | Detectable-cluster recall* | AUC | FP (components) |
|---|---|---|---|---|---|---|
| Easy test (held-out) | RandomForest | 1.000 | 1.000 | 1.000 | 1.000 | 0 |
| Easy test (held-out) | Rule-based baseline | 0.052 | 1.000 | — | 1.000 | 55 |
| Hard test (held-out) | RandomForest | 1.000 | 0.444 | 1.000 | 0.813 | 0 |
| Hard test (held-out) | Rule-based baseline | 0.066 | 0.556 | — | 0.739 | 71 |

\* **Detectable-cluster recall** counts only rings that form a graph cluster of size ≥ 5. A ring is, by this project's scope, a *graph-structure* problem: an account that shares no device/IP/referral with any co-conspirator forms no cluster and is inherently undetectable. The hard set's 5 "misses" are exactly such scattered singletons — every hard ring that forms a real cluster is caught (detectable-cluster recall = 1.0, 0 FP).

**Interpretation:** Obvious rings are caught with **zero false positives** by the ML model, while the rule-based baseline floods analysts with 55–71 false positives (precision ~5–7%) on the same data — the concrete false-positive-cost argument for the learned model, and exactly the trap Section 9.5 warns against. The **hard set is the honest measure of quality**: the ML model keeps 1.0 precision and perfect detectable-cluster recall, at the cost of not flagging ring members who form no cluster. That is a structural limitation of a graph-structural detector, not a tuning failure, and we report it openly rather than burying it in an inflated headline number. Full breakdown in `detection/model/training_report.json`; see `docs/PROGRESS.md` for the running log.

If the ML model underperforms the baseline on any core metric on a future, larger dataset, the baseline becomes primary and the ML model is removed.

### 10.3 Feature Importance & Explainability Audit

- **Feature importance ranking** — which features the model relies on most (should align with domain intuition: device concentration, temporal score, referral density should rank high)
- **SHAP summary plot** — global view of feature effects on predictions
- **Per-prediction SHAP breakdown** — for each flagged ring, show exactly which features pushed the score up (this feeds into the explanation panel in the dashboard)

### 10.4 False-Positive Cost

- Report how many legitimate accounts with shared-wifi/family-device overlap get incorrectly swept into a flagged ring
- Frame as **review-effort cost** (how many analyst hours to manually clear false positives), not just a raw count
- This is critical for honest evaluation — a detector that flags every shared IP would have 100% recall but unacceptable false-positive cost

### 10.5 Threshold Tuning

- Done on a **validation slice carved out of the training pool** (easy + hard rings), never on the held-out test sets, using the precision-recall curve to pick the operating point
- The primary operating point is **recall-oriented** (lowest threshold achieving ≥0.9 recall on the validation slice), because missing a coordinated ring is costly and false positives are near-zero at the chosen threshold
- Test split numbers reported once, unchanged — no post-hoc tuning on test
- The selected threshold (0.50) and its max-F1 alternative (0.54) are saved to `detection/model/threshold.json` and loaded at inference time

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

1. **Core detection logic** — generator → CSVs → graph queries → feature extraction → **ML training (RandomForest + XGBoost)** → scoring (ML-primary, rule-based fallback), all runnable locally/offline, no services yet. This alone proves the idea and produces the precision/recall/AUC numbers. ✅ DONE — `detection/train.py`, `detection/scoring.py`, `detection/explain.py` with SHAP, evaluated on dev + test splits.
2. **Wrap in real services** — Docker Compose with Postgres + Neo4j, loader script, FastAPI layer exposing `/rings`.
3. **Extras** — minimal dashboard/subgraph visualization, SHAP integration in dashboard, polish for the pitch video.

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
│   ├── graph_queries.py       # NetworkX (in-memory): connected components, referral cycles, shared device/IP
│   ├── features.py            # Feature extraction: builds 13-dim feature vector per component
│   ├── temporal.py            # signup-clustering scoring
│   ├── train.py               # Trains RandomForest + XGBoost, compares, saves winning model
│   ├── scoring.py             # Loads trained model, predicts on new components, flags rings
│   │                          #   isolated from the API layer — directly unit-testable against ground_truth.json
│   ├── explain.py             # Turns a flagged ring into plain-language reason + SHAP breakdown
│   └── model/                 # Saved model artifacts (gitignored except .gitkeep)
│       └── .gitkeep
│
├── evaluation/
│   ├── split.py               # dev/test split logic — lives outside detection/ so it can
│   │                          #   never accidentally be touched by tuning code
│   └── evaluate.py            # precision/recall/F1 + false-positive cost, run ONLY against
│                              #   test split — produces the numbers the track actually grades
│
├── api/
│   ├── main.py                # FastAPI app, logging config, request middleware
│   ├── rings_service.py       # Runs detection (NetworkX-based) + caches results per data dir
│   ├── neo4j_queries.py       # Real Cypher queries — subgraph + shared-entity enrichment
│   │                          #   for /rings/{id}/subgraph; Neo4j is the persistence/query
│   │                          #   layer for the API, NOT where core detection runs
│   ├── state.py               # Shared app state (cached detection, loaded model)
│   ├── routes/
│   │   ├── rings.py           # /rings, /rings/{id}, /rings/{id}/subgraph (subgraph from Neo4j)
│   │   ├── ingest.py          # /ingest — calls loader/load.py then detection/, backs
│   │   │                      #   both the CLI/API path and the dashboard's upload button
│   │   ├── evaluate.py        # /evaluate — exposes evaluation/evaluate.py's output
│   │   └── audit.py           # /audit — detection-run + per-ring audit events (live trail)
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
| ML overfits to synthetic data → looks great on dev, fails on test | Held-out test split (never tuned on) + cross-validation on dev set + comparison against rule-based baseline |
| Model is a black box → fails explainability requirement | Tree-based models provide feature importance natively; SHAP adds per-prediction additive explanations; plain-language reasons in explain.py |
| Small dataset (~20–30 components) → model can't generalize | RandomForest/XGBoost handle small data well; avoid deep learning; feature engineering extracts meaningful signals from limited samples |
| Feature leakage between train/test splits | Split at component level (not account level) — no component's features appear in both splits |
| ML underperforms rule-based baseline | Baseline retained for comparison; if ML loses, baseline becomes primary and ML is removed |
