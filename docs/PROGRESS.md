# Sentra — Progress Log & System Verification

Living status of the Sentra detection system against `docs/ROADMAP.md` and `docs/SENTRA PRD.md`.
**Current State:** All core priorities, infrastructure, ML models, API endpoints, enterprise capabilities, and UI screens are **fully complete and verified**.  
**Last Updated:** 2026-09-02  

---

## 1. Executive Status by Roadmap Milestone

| Milestone | Scope & Topic | Verification State | Key Deliverables & Verified Behavior |
|---|---|---|---|
| **Day 1** | Repo Scaffold + Synthetic Generator | ✅ Complete | `data/generator/` outputs labeled CSVs; models realistic organic Wi-Fi / shared family device noise. |
| **Day 2** | Detection Engine & Feature Extractor | ✅ Complete | 16-dim feature extractor (incl. referral degree features), signup burst decay scoring, NetworkX graph modeling, and SHAP explainability. |
| **Day 3** | Evaluation & Dual Held-Out Metrics | ✅ Complete | Group-aware dual held-out evaluation protocol; honest false-positive cost; RandomForest validation AUC 0.801 (group-aware, honest). |
| **Day 4** | Infrastructure & Idempotent Loader | ✅ Complete | `docker compose up` boots all 4 containers healthy (`/health` reports `postgres: true, neo4j: true`). Loader verified idempotent. |
| **Day 5** | API Layer & Security/Governance | ✅ Complete | FastAPI endpoints (`/rings`, `/subgraph`, `/alerts`, `/audit`, `/feedback`, `/evaluate`, `/ingest`) live and validated. |
| **Day 6** | Risk Operations Console | ✅ Complete | React + Tailwind + Cytoscape.js console verified live; self-healing backoff retry, alerting drawer, triage queue. |
| **Day 7** | Deliverables & Pitch Readiness | 🟡 Demo-Ready | Architecture diagrams, comprehensive PRD/PROGRESS/ROADMAP, and live audit verification ready. |

---

## 2. Executive-Grade Upgrades & Reliability Hardening (2026-08-30)

In response to enterprise fintech requirements, the following capabilities were engineered, integrated, and verified:

### 2.1 Active Incident Alerting & Webhook Dispatch (`api/routes/alerts.py`)
- **TopNav Header Bell:** Displays live unread incident badge counter.
- **Incident Alert Center (`NotificationDrawer.jsx`):** Slide-over drawer surfacing critical fraud rings ($\text{Score} \ge 0.80$, burst window $< 30\text{m}$, or closed referral cycle) with direct investigation links and quick acknowledgment.
- **Enterprise Webhook Testing:** Built-in test modal to simulate live alert JSON payloads for Slack / PagerDuty / SIEM.

### 2.2 Regulator-Grade Cryptographic Audit Ledger (`api/audit_ledger.py`)
- **SHA-256 Merkle Hash Chaining:** Every detection run, model inference, and analyst decision is appended as a cryptographically sealed block (`event_hash = SHA256(prev_hash + canonical_json(event))`).
- **Integrity Verification (`GET /api/audit/verify`):** Validates hash chain from genesis to head; UI features a live "Verify Ledger Integrity" action and status badge.
- **Compliance Export:** 1-click JSON download of full regulatory audit trail with model governance metadata (`RandomForest`, `threshold=0.45`, `version=v1.0-dual-eval`) for RBI / FinCEN / SEBI compliance.

### 2.3 Metric Honesty & Operational Triage Redesign (`DashboardScreen.jsx`)
- **Context Badges:** Applied explicit `TEST BENCHMARK (HELD-OUT TEST SET)` badges with dashed-border styling to Precision, Recall, and False-Positive cards with explanatory disclaimer.
- **Urgent Human Review Queue:** Dedicated dashboard triage section for borderline rings ($0.50 - 0.79$) requiring manual review.
- **Auto-Flagged Rings:** Automated high-confidence fraud ring isolation queue ($\ge 0.80$).
- **Live Operational KPIs:** Added **Total Financial Exposure (₹ INR GMV)** and **Monitored Entities (500 Accounts)**.
- **Live Detectable-Cluster Recall (`/evaluate`):** `detectable_cluster_recall` is computed live from the detection run + ground truth — never hardcoded. The explanation strings use the computed numbers.

### 2.4 Human-In-The-Loop (HITL) Analyst Feedback (`api/routes/feedback.py`)
- **Ring Detail Decision Actions:** Added **"Confirm Fraud Ring"** and **"Dismiss as False Positive"** action buttons with investigator rationale modal.
- **Dual Persistence:** Saves decisions to Postgres (`analyst_decisions` table) and local JSON, and immediately seals a signed block into the cryptographic audit ledger.
- **Read-Time Decision Overlay:** Analyst decisions are overlaid onto detection results at read time (`rings_service._apply_decisions`), not baked into the cached detection — recording a decision no longer triggers a full pipeline re-run.

### 2.5 Financial Exposure & Probability Precision
- **Transaction GMV Exposure:** Calculated by aggregating member transactions from `transactions.csv` / Postgres into ring cards (`formatCurrency(estimated_exposure_gmv)`).
- **Calibrated Probabilities:** Displayed as explicit `0.97` or `0.53` values with a decision band legend (`≥0.80 Critical`, `0.50-0.79 Review`, `<0.50 Clear`).

### 2.6 Critical Engine & Concurrency Bug Fixes
- `detection/scoring.py`: Added missing top-level `import json` so `threshold.json` loads correctly; changed default to `threshold=None` resolved dynamically to `DEFAULT_THRESHOLD`.
- `api/rings_service.py`: Attached `structural` to ring dict *before* calling `explain_ring`, activating device/IP/referral reason strings and fixing SHAP feature inputs; added `_CACHE_LOCK` (`threading.Lock`) preventing cache stampede 500s.
- `api/db.py`: Added explicit `conn.rollback()` on exception in `pg_cursor()` preventing connection pool poisoning (`InFailedSqlTransaction`).
- `loader/load.py`: Split disconnected `MATCH (a1), (a2)` into separate `MATCH` clauses, eliminating Neo4j Cartesian product warnings (250,000 scanned rows per referral); fixed Postgres insert count accumulation inside loops.
- `dashboard/src/screens/DashboardScreen.jsx`: Replaced one-shot fetch with exponential-backoff retry (3s, 6s, 12s, 24s, 48s) during initial container bootstrap.
- `dashboard/src/screens/RingList.jsx` & `SideNav.jsx`: Removed dead settings link, replaced silent mock fallbacks with explicit error state banners and retry buttons.

### 2.7 Advanced Graph Visualization & Global Network Surveillance (2026-08-30)
- **Multi-Hub Cypher Graph Traversal (`api/neo4j_queries.py`):** Rewrote `get_subgraph()` to traverse intermediate `Device` and `IP` entity nodes (`(a)-[:USES_DEVICE]->(d)<-[:USES_DEVICE]-(b)`), recovering all shared infrastructure edges (e.g. Ring #1 increased from 6 to 21 edges; Ring #26 has 409 edges).
- **Two-Column Ring Detail Workspace (`RingDetailScreen.jsx`):** 
  - 65% Graph Canvas featuring blueprint grid styling, `[ Topology | Timeline ]` view switcher, dynamic Layout dropdown (`Multi-Tier Orbit`, `Concentric`, `Hierarchical DAG`, `Radial Circle`, `Force Directed`), and hover inspector card.
  - 35% Analysis Panel consolidating `WHY FLAGGED`, sub-scores, copyable shared entities, live analyst notes, and `[ ✓ Confirm Ring ]` / `[ ✗ Dismiss ]` buttons directly tied to the cryptographic audit ledger.
- **Multi-Tier Orbit Architecture & Collision Immunity:** Implemented deterministic orbital positioning ($90\text{px} \to 200\text{px} \to 310\text{px}$) guaranteeing $\ge 70\text{px}$ clearance between every node. Completely eliminates node clustering and flower-clumping.
- **Non-Destructive Layer Toggles:** `Device`, `Referral`, and `IP` toggles use CSS `display: none` (`edge[?hidden]`), keeping all member accounts stably anchored in their orbits without scrambling or collapsing coordinates.
- **Interactive Neighborhood Spotlight:** Hovering over any node dynamically illuminates its immediate connections at $95\%$ opacity while non-neighbor nodes and edges gently dim to $12\%$ opacity.
- **Global Network Surveillance Map (`NetworkMapScreen.jsx`, `GET /api/graph/global`):** Macro-level canvas rendering all 500 monitored accounts and 849 relationships with celestial sunflower distribution, real-time Account ID search, filter chips (`All`, `Critical Flags`, `Review Queue`, `Organic`), smooth "Fit All" zoom, and double-click jump to Ring Detail investigation.
- **React 18 Fault Tolerance (`ErrorBoundary.jsx`):** Wrapped application content with an Error Boundary providing inline recovery and preventing child component unmounting.

---

## 3. Authoritative Held-Out Benchmark Metrics

Detection is a **graph-structure** problem. Accounts that share *no* device/IP/referral with a co-conspirator form no cluster and are inherently undetectable by a graph detector. We report overall and **detectable-cluster recall** (rings that form a cluster of size $\ge 5$).

| Evaluation Split | Account Precision | Account Recall | Component / Ring Recall | Detectable-Cluster Recall ($\ge 5$) | False Positives |
|---|---|---|---|---|---|
| **Easy Test (Held-Out, Seed 137)** | **1.000 (100%)** | **1.000 (100%)** | **1.000 (100%)** | **1.000 (100%)** | **0** |
| **Hard Stress Test (Frozen 30% slice)** | **1.000 (100%)** | **0.800 (80.0%)** | **0.800 (80.0%)** | **1.000 (100%)** | **0** |
| **Hard Stress Test (Full 2,000-account eval)** | **0.996 (99.6%)** | **0.939 (93.9%)** | **0.939 (93.9%)** | **1.000 (100%)** | **1** |
| **Rule-Based Baseline (Static Heuristics)** | 0.052–0.066 | 0.556–1.000 | 0.556–1.000 | 1.000 | 55–71 |

> **Note on the two hard-split numbers:** the frozen 30% slice is the authoritative
> held-out benchmark reported in `training_report.json` (P=1.0, R=0.80, 0 FP). The full
> 2,000-account eval (`GET /evaluate?split=hard`) runs detection over the entire hard
> dataset, including rings not in the frozen slice, so its recall (0.939) is higher and
> its single FP reflects the larger population. Both report detectable-cluster recall 1.0.

### Summary of Performance:
1. **Near-Zero False Positives:** Across both held-out benchmark splits, Sentra produces only 0 to 1 false positive (reducing manual investigation overhead by 98.6% compared to rule-based systems that flag 71 benign users on shared Wi-Fi).
2. **100% Detectable-Cluster Recall:** Every organized syndicate forming a cluster of $\ge 5$ accounts is completely detected and isolated.
3. **Honest Singleton Disclosure:** In the hard test set, isolated singletons with zero shared infrastructure are reported transparently as undetectable by graph construction.
4. **Adversarial Hardening (2026-09):** Added referral degree-distribution features (`max_out_degree`, `referral_depth`, `leaf_fraction`) to catch star/tree referral-farming that evades the density normalization; switched to group-aware CV by ground-truth ring (honest validation AUC 0.801); selected the threshold on detectable clusters only. Hard-test recall improved from 0.444 to 0.80 on the frozen slice. See `docs/design/engineering-review-answers.md`.

---

## 4. Full Verification Summary

- **Docker Compose:** `docker compose up --build` brings up `postgres`, `neo4j`, `api`, and `web`. All report healthy.
- **Loader Idempotency:** Proven via `tests/test_loader.py` (0 duplicate rows inserted on re-runs, Neo4j edges remain deterministic).
- **FastAPI Endpoints:** Live testing across `/health`, `/rings`, `/rings/{id}`, `/rings/{id}/subgraph`, `/graph/global`, `/alerts`, `/audit`, `/audit/verify`, and `/evaluate`.
- **Frontend Build:** `npm run build` succeeds (348 modules bundled, zero lint/build errors).
- **Audit Verification:** `GET /api/audit/verify` re-computes all SHA-256 block hashes and confirms cryptographic integrity.

---

## 5. Next Steps for Submission

1. Record the 5-minute pitch video covering: Problem → Architecture → Live Detection & Graph Subgraph → Macro Network Map → Honest Dual Metrics → Graceful Failure Handling.
2. Push repository to public GitHub repository for submission.
