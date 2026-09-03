# Engineering Review — Answers to Senior-Staff Technical Questions

Status: **Draft for review** · Owner: Architect · Scope: interview/pitch defense + hardening backlog

This document answers the five hard technical questions a Senior Staff / Principal
Engineer at Razorpay would ask about Sentra. Each answer is grounded in the actual
code, distinguishes **"already handled"** from **"real gap"**, and gives the concrete
mitigation. It doubles as the hardening backlog — items marked **[GAP]** are
candidates for implementation; items marked **[HANDLED]** are documented decisions.

---

## 1. Data Pipeline & Graph Scalability

### 1a. Why NetworkX in-memory instead of distributed graph compute?

**Answer: it is the correct architecture for the stated scope, and the feature
extractor is already decoupled from the graph backend so the migration path is clean.**

- The PRD locks scope to **batch, offline, ~500-account synthetic datasets**. At that
  size the graph is ~1,000 edges; NetworkX is the right tool.
- The detection engine (`detection/`) is deliberately **CSV-backed and DB-free**. That
  is what makes it directly unit-testable against `ground_truth.json` and re-runnable —
  a property the grading bar depends on. Pulling in Spark/cuGraph would break it.
- **The interface survives the swap.** `extract_features_for_component(component, accounts_df, graph)`
  takes a `component: dict` and a `graph` — it is backend-agnostic. Only
  `build_graph` / `find_components` are NetworkX-bound. To scale, swap those two for
  Neo4j GDS projection or cuGraph connected-components, and the feature extractor runs
  unchanged on the returned component dicts.

### 1b. The supernode problem — **[GAP]**

`build_graph` creates an edge between *every pair* of accounts sharing a device/IP
(`for i in range(len(account_ids)): for j in range(i+1, ...)`), i.e. O(k²) per shared
entity. A carrier-NAT IP with 10,000 accounts → ~50M edges → one giant component →
the 16-dim extractor computes features across 100k merged nodes and density /
`max_possible` math collapses.

**Mitigation (two guards):**
1. **Entity-cardinality gate.** Before forming pairwise edges, check the degree of the
   shared entity. If an IP/device is shared by more than a threshold (e.g. 50 accounts),
   treat it as a supernode (carrier NAT, corporate proxy, public wifi) and **exclude it
   from edge formation** (or demote to a weak signal) rather than bridging a mega-component.
2. **Component-size cap.** `get_candidate_components` already filters by size, but
   feature extraction runs on *all* components. Add a guard: components above a size
   ceiling (e.g. 200) are skipped for ML scoring — density → 0 and concentration → 0
   make them structurally meaningless.

---

## 2. Attack Vector Evasion & Adversarial Blindspots

### 2a. Temporal jitter (3–7 day staggered signups) — **[HANDLED]**

`temporal.py`: `score = exp(-ln2 * burst_minutes / half_life)` with `half_life=360`.
A 3-day (4320 min) burst → `exp(-8.3)` ≈ **0.0002**. So a staggered campaign drives
temporal score to ~zero.

**But the ML path does not gate on temporal.** In `scoring.py`, the ML branch
(`use_ml=True`) flags purely on the learned threshold; the comment explicitly states the
rule-based temporal gate is *not* applied in ML mode because it would silently drop hard
rings. So a low-velocity ring is still caught by **structural** features (density,
device/IP concentration, referral density) even when `temporal_score ≈ 0`.

**Residual blindspot:** a ring that is BOTH low-velocity AND structurally clean (see 2b).

### 2b. Tree/star referral farming + rotated residential proxies — **[IMPLEMENTED]**

If a syndicate removes all cycles (`has_referral_cycle = False`) and rotates 1 proxy per
account (`unique_ips ≈ size`), the remaining signals are:
- **device concentration** — collapses if devices are rotated too.
- **referral density** — a star (1 root → N) has `referral_edges = N-1` but
  `max_possible = N(N-1)/2`, so `referral_density ≈ 2/N` → near zero. **The current
  density normalization actively hides star structures.**
- **signup burst** — killed by jitter.

**The non-collapsing structural signal is referral *tree shape*, not density.** A
farming star has a distinctive degree distribution (one high-out-degree root, many
leaves) that organic referral graphs lack. The current 13 features have **no
degree-distribution feature**. Add:
- `max_out_degree` / `max_in_degree` of the referral subgraph
- `referral_tree_depth`
- `leaf_fraction` (fraction of nodes with out-degree 0)

A farming star has `max_out_degree ≈ N-1`, `depth ≈ 1`; organic referrals are shallow
balanced trees. This survives both proxy rotation and cycle removal.

---

## 3. Dual Storage Consistency & System Architecture

### 3a. Postgres ↔ Neo4j consistency during batch ingestion — **[HANDLED]**

**There is no distributed transaction, and there should not be one.** The loader writes
to Postgres and Neo4j as two *independent idempotent* operations:
- Postgres: `INSERT ... ON CONFLICT DO NOTHING`
- Neo4j: `MERGE`

**Idempotency is the recovery mechanism.** Because every write is idempotent, re-running
a failed batch converges both stores. There is no "half-inserted" state a retry can't fix.
This is the standard batch-ingestion answer: *don't make two stores atomic; make the
operation re-runnable so a retry converges them.*

- **Postgres is source of truth; Neo4j is a derived projection**, fully reconstructible
  from CSVs. If Neo4j desyncs, drop and reload from the batch. The loader is the *only*
  write path — no competing writer to reconcile.
- **Detection does not read the DBs for scoring** — it reads CSVs directly
  (`rings_service.py`). A PG/Neo4j desync does not corrupt detection; it only affects
  subgraph/shared-entity reads, which have CSV fallbacks (`rings.py`).

**Honest gap:** no explicit batch-status tracking (pending/committed/failed) or
reconciliation job. Acceptable for the buildathon; the invariant we guarantee is
*re-running the loader converges both stores*.

### 3b. /ingest latency, locking, worker starvation — **[GAP]**

`ingest.py` is `async def`, but calls `load_batch`, `ring_list`, and
`clear_detection_cache()` **synchronously in the request handler**. `ring_list` →
`run_detection` → `_compute_detection` runs the *entire* pipeline (CSV load + graph build
+ ML) inline, under a single `threading.Lock` in `rings_service.py`. Consequences:
- `/ingest` blocks the event loop / threadpool during CPU-heavy detection.
- Concurrent `/rings` requests block on the **same global cache lock** → latency spike +
  worker starvation.
- `_DETECTION_CACHE` is one global dict with one lock — a big batch re-run blocks all
  analytical reads.

**Fix:** make `/ingest` **asynchronous** — return `202 Accepted` with `batch_id`
immediately, enqueue load+detect as a background job, and let `/rings` poll status.
Key the detection result by `batch_id` (per-batch cache), not a single global cache, so
the active batch's reads are not blocked by the new batch's compute. This is the "async
batch triage queue" the interviewer is probing for.

---

## 4. Machine Learning Robustness & Leakage

### 4a. Why XGBoost collapsed to 0.48 while RandomForest got 0.84 — **[IMPLEMENTED]**

The premise "XGBoost beats RF on tabular" holds on dense, well-scaled data. The failure
here is **sparse, unscaled, extreme-imbalance graph-level features**, via three mechanisms:

1. **Extreme class imbalance.** ~500 accounts, a handful of rings → component-level
   labels are heavily skewed. XGBoost's default handling collapses to majority-class
   prediction on tiny datasets → AUC ~0.5. The code sets `scale_pos_weight = neg/pos`,
   but on a tiny pool (a few dozen components, 3–5 positive) that is fragile.
2. **Unscaled, heavy-tailed features.** `size`, `unique_devices`, `unique_ips`,
   `burst_minutes` are raw counts with huge dynamic range. RandomForest's bagging is far
   more robust to this on small data than gradient boosting's residual fitting.
3. **Improper CV splits across disconnected subgraphs — the load-bearing one.**
   `StratifiedKFold(shuffle=True)` splits on *component rows*, but components are not
   independent — they derive from the same graph. If components from the same connected
   component / ring land in both train and validation, that is **leakage**. RF's averaging
   forgives it; XGBoost's boosting amplifies the overfit.

**Fix:** **group-aware CV** — split by connected component / ring ID, never by row.

### 4b. Overfitting to the generator — **[HANDLED, with a residual gap]**

Existing defenses:
- **Two fully independent datasets** (`split.py`): dev (seed 42) and test (seed 137),
  generated with different seeds. Test is never used for training or threshold tuning.
- **Hard test set** (`data/raw_hard`) with subtle rings (partial overlap, long burst, no
  cycle) — the honest measure; `detectable_cluster_recall` is reported separately.
- **Threshold selected on a validation slice** carved from the training pool, never on
  held-out tests.

**Residual weakness:** dev and test come from the *same generator*. The model can overfit
to the generator's distributional quirks across seeds. Evidence it hasn't: (a) it
generalizes to the *hard* set with deliberately different ring characteristics; (b) the
rule-based baseline is reported alongside, showing whether ML adds value over a heuristic.

**Strongest additional evidence:** a held-out set generated with **different generator
parameters** (ring sizes, overlap patterns, temporal spreads) — not just a different seed.

---

## 5. Operational Latency & False-Positive Tradeoffs

### 5a. Sub-200ms edge intervention — **[HANDLED — out of scope by design]**

Sentra is **not** a real-time edge system, and should not pretend to be. This is a PRD
non-goal (batch, re-runnable on demand). Own the scope boundary:

- Sentra detects *coordinated rings* — a structural pattern visible only *after* multiple
  accounts sign up and form edges. You cannot catch a 10-account ring at the *first*
  account's onboarding; there is no signal yet. A batch detector is the *correct* tool for
  this fraud class.
- **The production answer is two-tier:** a cheap per-account *edge* rule (e.g. "this
  device/IP already onboarded N accounts in M minutes" — a fast Postgres/Redis lookup,
  sub-200ms) that holds/flags the risky account at onboarding, plus Sentra's *batch* graph
  analysis that runs periodically to catch the ring and trigger remediation (freeze,
  clawback, review). The batch output **feeds** the edge rules with learned entity-risk
  scores. Edge rules for latency; batch graph detection for precision.

### 5b. "Dismiss as False Positive" — **[HANDLED, with a wiring gap]**

`feedback.py` on `DISMISS_FALSE_POSITIVE`:
1. Persists the decision to Postgres (`analyst_decisions`) with file fallback.
2. Appends an **immutable cryptographic event to the audit ledger**.
3. Invalidates the detection cache so `/rings` reflects `dismissed_fp`.

It does **NOT** retrain weights, mutate graph adjacency, or suppress future alerts for the
entity pairs. **That is correct.** A single analyst decision is far too little signal to
retrain a model, and silently mutating adjacency weights would corrupt the audit trail and
the honest metrics. The correct production pattern is a **feedback loop**: decisions are
logged as labeled training data, accumulated, and only *periodically* folded into a
retraining run (with the same dev/test discipline). Immediate weight mutation is not
auditable and cannot be rolled back.

**Honest gap:** decisions are stored in `analyst_decisions` but **not wired into
`train.py`**. Add a documented path for feedback to reach the retraining pipeline.

---

## Backlog summary

| # | Item | Verdict | Status |
|---|------|---------|--------|
| 1b | Entity-cardinality gate + component-size cap | GAP | Documented (pitch defense) |
| 2b | Referral degree-distribution features (max_out_degree, depth, leaf_fraction) | GAP | **IMPLEMENTED** |
| 3a | Batch-status tracking / reconciliation | GAP (doc) | Documented |
| 3b | Async /ingest (202 + background job) + per-batch cache | GAP | Documented (pitch defense) |
| 4a | Group-aware CV by component/ring | GAP | **IMPLEMENTED** |
| 4b | Cross-parameter held-out set | GAP | Documented |
| 5a | Two-tier edge+batch architecture doc | HANDLED (doc) | Documented |
| 5b | Wire analyst feedback into retraining | GAP | Documented |

## Implementation record (2026-09)

The two high-ROI items were implemented and the model artifact re-frozen:

**1. Referral degree-distribution features (§2b).** `detection/features.py` now
computes a **16-dim** vector: `max_out_degree`, `referral_depth`, `leaf_fraction`
computed from the direction-preserving referral digraph restricted to each component.
Ring components show the expected signature (max_out 4–12, depth 3–5, leaf_fraction 0.0
— closed loop) vs normal components (max_out 1, depth 1, leaf_fraction 0.5+).

**2. Group-aware CV (§4a).** `detection/train.py` now:
- Groups components by ground-truth ring (`build_groups`) — components from the same
  ring never straddle train/validation or CV folds (`GroupShuffleSplit` +
  `StratifiedGroupKFold`).
- Selects the threshold on **detectable clusters only** (size ≥ 5). Undetectable
  singletons (ring members with no shared edges) previously dragged the recall-oriented
  threshold to 0.01, flagging the entire population (304–350 FPs). This matched the
  existing `detectable_cluster_recall` philosophy: don't let inherently undetectable
  accounts distort the operating point.

**Re-frozen model results** (`detection/model/training_report.json`):

| Metric | Before (leaky) | After (group-aware) |
|--------|---------------|--------------------|
| Validation CV AUC | 0.8385 | **0.8010** (honest) |
| Hard test AUC | 0.8129 | **0.9142** |
| Hard test recall | 0.444 | **0.800** (detectable-cluster R = 1.0) |
| Hard test precision | 1.0 | 1.0 (0 FP) |
| Easy test | P=1.0 R=1.0 | P=1.0 R=1.0 (0 FP) |
| Threshold | 0.5 | 0.45 |

The validation AUC *drop* (0.84 → 0.80) is the honest number — the previous figure was
inflated by ring fragments leaking across folds. Meanwhile hard-test AUC and recall both
*improved* because the group-aware split stopped leaking ring fragments into training.
SHAP global importance now ranks `referral_depth` #2 overall (behind `shared_device_edges`),
and per-ring SHAP shows `referral_depth` as the top contributor — the new features are
actively driving detection, not just present.

## Implementation record (2026-09, code-review round)

A principal-engineer code review found one correctness bug and several hot-path
inefficiencies. All P0/P1 items were fixed and verified (13/13 tests pass):

**P0 — correctness:**
1. **Served-threshold desync (fixed).** `scoring.py` loaded `threshold.json` (0.45) then
   unconditionally overwrote `DEFAULT_THRESHOLD` with the UI band constant (0.80) — the API
   served a different operating point than the evaluated one, and the audit ledger stamped
   the artifact's threshold into blocks while decisions were made at 0.80. Fixed; guarded by
   `tests/test_detection.py::test_served_threshold_matches_trained_artifact`.
2. **`/evaluate` hardcoded `detectable_cluster_recall: 1.0` (fixed).** Now computed live
   from the detection run + ground truth (`_detectable_cluster_recall`); explanation strings
   use the computed numbers. Verified: easy 3/3, hard 15/15.
3. **SHAP explainer reloaded the model from disk per ring (fixed).** Module-level cache;
   ~50% of the detection hot path was re-pickling the same RandomForest. Clean rings skip
   SHAP entirely (`include_shap=False` — their explanations are never rendered).

**P1 — efficiency (measured):**
4. **Detection hot path: 1.00s → 0.18s warm (~5.5×).** Graph/components passed through to
   `detect_rings` (was built twice per run, ~18%); temporal computed once per candidate and
   threaded into feature extraction (was computed twice).
5. **Decision overlay at read time.** `rings_service._apply_decisions` runs on the fresh
   copy in `run_detection`; `feedback.py` no longer invalidates the whole detection cache
   (a full pipeline re-run per analyst click).
6. **Batched ingestion.** Neo4j writes use `UNWIND` chunks; Postgres uses chunked multi-row
   `INSERT ... ON CONFLICT DO NOTHING` with accurate per-page rowcounts. Idempotency
   semantics unchanged (verified by the loader idempotency test).
7. **`/ingest` parses CSVs once** (validation parse passed through to `load_batch`).

**P2 — tests: 1 → 13.** `tests/test_detection.py` covers the threshold-desync regression,
feature/model width consistency, group-aware CV invariants, the singleton-drags-threshold
failure mode, degree features on star/cycle/chain, prebuilt-graph equivalence, and the
decision overlay.

**Deliberately NOT built (pitch-defense documentation only):** async `/ingest` (202 +
background job), supernode cardinality gate, analyst-feedback retraining pipeline — see
the backlog table above.
