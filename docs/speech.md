# Sentra Pitch Speech

## 1. Hook + Problem framing (0:00–0:35)

Open with the actual fraud pattern — 68 fake accounts across 3 rings, each unremarkable alone. Each one makes a ₹100 payment, passes basic KYC, looks like a normal new user. No single transaction is anomalous. No synthetic name or phone number raises a red flag on its own. The fraud is not in any individual account; it's in the coordination between them. This is the strongest hook you have, and it immediately shows you understand the problem before you've said a word about your solution.

One line transitioning into: this is a coordination problem, not a per-transaction problem — that's why per-transaction fraud detection structurally can't see it. A rule engine evaluating ₹100 payments in isolation is blind to the network. Identity fragmentation — unique names, phones, emails across accounts — evades string matching. Point-in-time blindness — evaluating account N without topological graph traversal over accounts 1 through N-1 — misses the shared infrastructure. You cannot detect a ring by looking at transactions one at a time. You need graph structure.

## 2. Track + problem statement (0:35–0:55)

Track 02, AI Risk Manager. The mandate: one class of loss, deep scoping, not broad. Coordinated abuse rings — that's the one class. Why scoping to one class deep beats five classes shallow: when you try to detect card-testing, ATO, credit default, and abuse rings all at once, each model is shallow and misses the coordination patterns that define rings. By scoping to one class — coordinated signup/referral abuse rings — we can go deep on the topology: shared devices, shared IPs, referral cycles, velocity bursts. Deep on one class means we can build structural detectors (NetworkX connected components, Cypher referral-cycle detection) and ML features (16-dimensional feature vectors) that actually catch the pattern. Five classes shallow would give you five headline numbers that look good but miss the real problem. One class deep gives you real precision/recall numbers on a held-out test set — and that's what the grading bar measures.

## 3. Your solution — the approach (0:55–1:45)

Graph-based structural detection using NetworkX + ML scoring using RandomForest + explainability using SHAP and plain-language. Keep this tight — architecture detail belongs in the README, not competing for video time with your demo and honesty sections, which are your actual differentiators.

The pipeline: raw CSVs → graph construction (undirected Account-Device-IP graph + directed referral graph) → connected component extraction → 16-dimensional feature extraction per component → trained RandomForest inference → score-band triage (Auto-Flagged ≥ 0.80, Urgent Review 0.50–0.79, Clear < 0.50) → additive model explainability (SHAP values + plain-language reason strings detailing shared device/IP fingerprints and referral loopbacks).

The key insight: fraud detection as a relational graph and topology problem, not a per-transaction anomaly problem. Evaluate the entire relational fabric across accounts, hardware devices, IP endpoints, payment tokens, and referral lineages. Quantify structural cohesion, cyclic topology, and temporal synchronization.

## 4. Live demo, narrated component by component (1:45–3:15)

This is the longest section — walk the reviewer through the actual product, sequenced by what it proves, not page order.

**Rings/Investigation Queue** — show the decision-band legend: Critical (auto-flagged ≥ 0.80), Review (borderline 0.50–0.79), Cleared (< 0.50). Click into a Critical ring — Ring #121, the closed-loop one — briefly. Show that the system automatically classifies it as Critical because of the closed referral cycle plus high device concentration.

**Ring Detail + graph** — this is the visual centerpiece. Show the Analysis Panel, the "Why Flagged" explanation, the referral-cycle badge, shared entities. Let the graph itself breathe on screen for a few seconds rather than narrating every pixel. The Cytoscape.js force-directed canvas shows accounts in blue, devices in purple, IPs in amber. Edges are dashed for referrals, solid for shared device/IP. The analyst can see at a glance: 25 accounts, 2 devices shared across all of them, a closed referral loop, and a 18-minute burst window. That's the power of visualizing the topology.

**Network Map** — your differentiator. 10-15 seconds showing the full 500-account view with clusters visually separating from the organic mass. Say plainly what it's for: letting an analyst independently spot patterns the model didn't flag. The model catches what it's trained on, but the network map lets the human see the full picture — clusters of shared devices, IP groups, referral chains — and validate or challenge the model's decisions. This is the HITL component: the analyst in the loop, not replaced by the model.

**Audit Trail** — a few seconds showing a real confirmed decision sealed into the ledger. Tie back to the HITL story: an analyst clicks "Confirm Fraud" on Ring #26, the decision persists in PostgreSQL `analyst_decisions` table, and immediately generates a signed, chained SHA-256 block in the cryptographic audit ledger. The ledger verifies zero data tampering — from the Genesis block through the current chain head. This is regulator-grade compliance: RBI, FinCEN, SEBI ready.

## 5. Honest metrics (3:15–4:00)

Your strongest material, don't rush it.

Clean split: 100/100/0 — Easy held-out test (Seed 137), Precision 1.000, Recall 1.000, 0 false positives. The model catches all 3 injected rings on the easy test with zero false alarms.

Hard split: the honest recall drop. Hard Stress Benchmark 30% Slice — Precision 1.000, Recall 0.800 (80.0%). In the hard stress set, attackers intentionally decouple accounts into isolated singletons (sharing 0 devices/IPs with any co-conspirator). Because Sentra is strictly a graph-structural detector, singletons with no edges cannot form graph clusters by definition. However — and this is the important part — every hard ring that formed a detectable cluster (≥ 5 accounts) was identified with 100% precision and zero false positives. That's the reframe: the model doesn't miss detectable clusters. The "misses" are graph singletons by construction — accounts that share no device, no IP, and no referral edge with any co-conspirator. That's not a model failure; that's the PRD's stated scope: a ring is a graph-structure problem, and accounts that share zero infrastructure with co-conspirators are inherently undetectable.

If you have time: the Ring #1 fractional-miss/needs-review story, compressed to one or two sentences. Some rings fall in the 0.50–0.79 review band — borderline structural signals that an analyst can adjudicate. That's the review queue working as designed.

## 6. What broke, and how you got out (4:00–4:40)

This is the form's own signal that they read this section first — treat it that way. You have exceptional real material here. Choose 2-3 of your strongest, most concrete bugs.

**The mock-data bug**: three dashboard screens silently serving fabricated numbers instead of live API data. Caught before it shipped — would have meant demoing fake results as real. The symptom: the Command Center KPI cards showed constant ₹142,500 GMV exposure and 3 flagged rings regardless of the actual data batch. The root cause: the dashboard was reading from a static JSON fixture loaded on first render, not from the FastAPI `/api/rings` endpoint. Fix: replaced fixture with real API calls, added exponential backoff retry when the API was momentarily unavailable during startup.

**The _pg_pool shadowing bug**: a health check silently lying about database connectivity. The `/health` endpoint returned `"postgres": true` even when the connection pool was exhausted and queries were failing. The root cause: `_pg_pool` in `api/db.py` was a module-level singleton that never reflected the actual connection state — a previous successful connection lived in the pool variable, making subsequent health checks lie. Fix: added explicit `conn.rollback()` in the `pg_cursor()` context manager with dead connection recycling, and made the health check probe actual query execution, not just pool existence.

**The exponential Neo4j query blowup**: worked fine in testing, would have hung indefinitely on slightly different data. The `get_global_graph` Cypher query was a single massive MATCH pattern across all accounts and relationships — on the full 500-account dataset with ring clusters, the query would scan Cartesian products and never return. Fix: split disconnected pattern matches into distinct MATCH statements; add local in-Python cycle analysis instead of one monolithic Neo4j traversal; implement query timeout and fallback to CSV-backed graph when Neo4j latency exceeds 2 seconds.

Frame each in one sentence: what broke, why it was dangerous, how you found and fixed it. This section is your credibility proof — it shows you test for real, not just for show. The form reads this first for a reason. These aren't hypothetical bugs; these are real near-ships that were caught and fixed before demo day.

## 7. Close — known tradeoffs + what's next (4:40–5:00)

CSV/NetworkX-for-detection vs. Neo4j-for-serving: the detection engine runs on NetworkX over CSVs for offline batch re-runnability, while Neo4j serves the subgraph and global graph views in the live console. The gap: bringing the full NetworkX pipeline into Neo4j serving would require re-implementing 16-dimensional feature extraction in Cypher, which is on the roadmap but not in this batch.

Batch vs. real-time: Sentra is batch-re-runnable on demand — POST /ingest triggers a full re-detection cycle. Real-time incremental detection per-signup is not in scope for the buildathon; it would require a Kafka pipeline, incremental graph updates, and is a named next step after the demo.

VPN/ASN detection as a named next step: currently the system detects shared IP addresses, but flagging known VPN/proxy ASNs is a natural extension. The `ips` table already has an `is_vpn_proxy` flag in the schema — it just isn't wired into the feature vector yet. Named next step: add VPN/ASN concentration as a 17th feature and retrain on the hard stress split.

One sentence each, showing you know the production gap without pretending you've closed it. You've built a capable, honest prototype — the tradeoffs are known, the path forward is clear, and the core detection logic already works.

## 8. Q&A defense — "Isn't a referral cycle temporally impossible?"

If a judge asks how C can refer A when A already exists, lead with the reframe: the signal is **dense, self-contained referral structure**, not a literal temporal cycle.

Say this: "Rings show dense, self-contained referral structures — referrals circulate inside the group and never reach organic users. Our ground truth models this at its most extreme as a literal closed loop; under action-based reward programs like Razorpay's own Partner Program — which pays the bonus on the referred party's first *transaction*, not signup — such loops are obtainable by referring dormant accounts. And the detector doesn't rely on the cycle alone: referral density, degree distribution, shared devices/IPs, and signup bursts carry the score. `has_referral_cycle` is one of sixteen features."

Backup facts if pressed further:
- The generator marks ring referrals `is_ring_referral=True` in ground truth; organic referrals enforce strict earlier-signup ordering (acyclic by construction) — the contrast between the two IS the learnable signal.
- Even with chain referrals instead of a loop, a ring still gets flagged: density, `max_out_degree`, `leaf_fraction`, device/IP concentration, and burst timing are independent features.
- The PRD (§2.1) documents this justification, so the docs, the data, and the pitch all tell the same story.