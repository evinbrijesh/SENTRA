import { useEffect, useMemo, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import Icon from "../components/Icon.jsx";
import { fetchRing, fetchSubgraph, submitDecision } from "../lib/api.js";
import { formatBurstWindow, formatCurrency, formatScoreProb, scoreBandMeta, signalIcon, signalLabel } from "../lib/format.js";

cytoscape.use(dagre);

const STATUS_LABELS = { flagged: "Ring Detected", needs_review: "Needs Review", clean: "Cleared" };

function legendItems() {
  return [
    { color: "#ef4444", label: "Referral Edge" },
    { color: "#3b82f6", label: "Shared Device" },
    { color: "#a855f7", label: "Shared IP" },
    { color: "#10b981", label: "Member Account" },
  ];
}

export default function RingDetailScreen({ ringId, onBack }) {
  const [ring, setRing] = useState(null);
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Decision Modal State
  const [decisionModal, setDecisionModal] = useState({ open: false, action: null });
  const [analystNotes, setAnalystNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(null);

  const loadRingData = () => {
    setLoading(true);
    setError(null);
    Promise.all([fetchRing(ringId), fetchSubgraph(ringId)])
      .then(([r, s]) => {
        setRing(r);
        setSub(s);
      })
      .catch((e) => {
        setError(e.message || "Failed to load ring");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadRingData();
  }, [ringId]);

  const handleDecisionSubmit = async () => {
    if (!decisionModal.action) return;
    setSubmitting(true);
    setFeedbackSuccess(null);
    try {
      const res = await submitDecision(ringId, {
        action: decisionModal.action,
        analystId: "analyst_rzp_ops_01",
        analystRole: "L2_RISK_INVESTIGATOR",
        notes: analystNotes,
      });
      setFeedbackSuccess(res.message || "Decision sealed cryptographically in audit ledger");
      setDecisionModal({ open: false, action: null });
      setAnalystNotes("");
      loadRingData();
    } catch (err) {
      alert(`Decision submission failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const explanation = useMemo(() => ring?.explanation || {}, [ring]);
  const sharedEntities = useMemo(() => ring?.shared_entities || {}, [ring]);
  const decision = useMemo(() => ring?.analyst_decision, [ring]);
  const band = useMemo(() => scoreBandMeta(ring?.ring_score), [ring]);

  const elements = useMemo(() => {
    if (!sub?.nodes || !sub?.edges) return [];
    const nodes = sub.nodes.map((n) => ({
      data: {
        id: n.data.id,
        label: n.data.id,
        kyc: n.data.kyc_status === "verified",
        signup: n.data.signup_time,
      },
    }));
    const edges = sub.edges.map((e, i) => ({
      data: {
        id: `e${i}`,
        source: e.data.source,
        target: e.data.target,
        reasons: e.data.reasons || [],
      },
    }));
    return [...nodes, ...edges];
  }, [sub]);

  const cyRef = useMemo(
    () => ({
      elements,
      layout: { name: "dagre", rankDir: "LR", spacingFactor: 1.1 },
      stylesheet: [
        {
          selector: "node",
          style: {
            "background-color": "#10b981",
            label: "data(id)",
            color: "#e5e7eb",
            "font-size": 10,
            "text-valign": "center",
            "text-halign": "center",
            width: 45,
            height: 45,
            "border-width": 2,
            "border-color": "#1f2937",
          },
        },
        {
          selector: "node[kyc]",
          style: { "background-color": "#22c55e", "border-color": "#16a34a" },
        },
        {
          selector: "edge",
          style: {
            width: 2.5,
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "line-color": "#374151",
            "target-arrow-color": "#374151",
          },
        },
        {
          selector: 'edge[reasons*="referral"]',
          style: { "line-color": "#ef4444", "target-arrow-color": "#ef4444", width: 3.5 },
        },
        {
          selector: 'edge[reasons*="device"]',
          style: { "line-color": "#3b82f6", "target-arrow-color": "#3b82f6", width: 3 },
        },
        {
          selector: 'edge[reasons*="ip"]',
          style: { "line-color": "#a855f7", "target-arrow-color": "#a855f7", width: 3 },
        },
      ],
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
    }),
    [elements]
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-on-surface-variant">
        <Icon name="sync" className="animate-spin text-3xl text-primary" />
      </div>
    );
  }
  if (error || !ring) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-on-surface-variant">
        <Icon name="error" className="text-3xl text-error" />
        <p className="font-code-sm text-code-sm">{error || "Ring not found"}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top Navigation & Actions */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <button
            onClick={onBack}
            className="mb-2 flex items-center gap-1 font-code-sm text-code-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            <Icon name="chevron_left" className="text-[16px]" /> Back to risk queue
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-display-lg font-display-lg font-bold text-on-surface">Ring #{ring.component_id}</h2>
            <span
              className={`rounded-full px-3 py-1 font-code-sm text-code-sm uppercase tracking-wider font-bold border ${band.cls}`}
            >
              {band.label}
            </span>
          </div>
          <p className="mt-1 font-code-sm text-[12px] text-on-surface-variant">
            Detected {ring.detected_at ? new Date(ring.detected_at).toLocaleString() : ""} · Model Score: {formatScoreProb(ring.ring_score)}
          </p>
        </div>

        {/* Action Header Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDecisionModal({ open: true, action: "DISMISS_FALSE_POSITIVE" })}
            className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2.5 font-code-sm text-body-sm font-medium text-on-surface transition-all hover:border-outline hover:bg-surface-container-highest"
          >
            <Icon name="cancel" className="text-lg text-outline" />
            Dismiss False Positive
          </button>
          <button
            onClick={() => setDecisionModal({ open: true, action: "CONFIRM_FRAUD" })}
            className="flex items-center gap-2 rounded-lg bg-error px-5 py-2.5 font-code-sm text-body-sm font-semibold text-white shadow-lg shadow-error/20 transition-all hover:bg-error/90 active:scale-95"
          >
            <Icon name="gpp_bad" className="text-lg" />
            Confirm Fraud Ring
          </button>
        </div>
      </div>

      {/* Analyst Decision Status Banner if present */}
      {decision && (
        <div
          className={`flex items-center justify-between rounded-xl border p-4 font-code-sm text-body-sm ${
            decision.action === "CONFIRM_FRAUD"
              ? "border-error/40 bg-error/10 text-error"
              : "border-outline-variant bg-surface-container-high text-on-surface"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Icon name={decision.action === "CONFIRM_FRAUD" ? "verified" : "check_circle"} className="text-xl" />
            <div>
              <span className="font-bold">
                {decision.action === "CONFIRM_FRAUD" ? "Confirmed Coordinated Fraud Ring" : "Dismissed as False Positive"}
              </span>
              <span className="text-on-surface-variant text-[12px] ml-2">
                by {decision.analyst_id} ({decision.analyst_role}) on {new Date(decision.decided_at).toLocaleTimeString()}
              </span>
              {decision.notes && (
                <div className="text-on-surface-variant text-[12px] mt-0.5 font-sans">Notes: {decision.notes}</div>
              )}
            </div>
          </div>
          <span className="rounded bg-surface-container px-2.5 py-1 text-[11px] font-bold border border-outline-variant">
            Sealed in SHA-256 Ledger
          </span>
        </div>
      )}

      {feedbackSuccess && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 font-code-sm text-emerald-400">
          ✓ {feedbackSuccess}
        </div>
      )}

      {/* Impact & Key Stat Overview */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="glass-panel flex flex-col justify-between rounded-xl p-5 border border-tertiary/30 bg-tertiary/5">
          <div className="flex items-center justify-between text-tertiary">
            <span className="font-code-sm text-code-sm uppercase tracking-wider">Est. Financial Exposure</span>
            <Icon name="account_balance" className="text-xl" />
          </div>
          <div className="mt-2">
            <div className="text-display-md font-display-md text-tertiary font-bold">
              {formatCurrency(ring.estimated_exposure_gmv)}
            </div>
            <div className="font-code-sm text-[12px] text-on-surface-variant/80">Aggregated Transaction GMV</div>
          </div>
        </div>

        <div className="glass-panel flex flex-col justify-between rounded-xl p-5">
          <div className="flex items-center justify-between text-primary">
            <span className="font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">Member Accounts</span>
            <Icon name="group" className="text-xl" />
          </div>
          <div className="mt-2">
            <div className="text-display-md font-display-md text-on-surface font-bold">
              {ring.members?.length || ring.size} Accounts
            </div>
            <div className="font-code-sm text-[12px] text-on-surface-variant/80">Coordinated signup cluster</div>
          </div>
        </div>

        <div className="glass-panel flex flex-col justify-between rounded-xl p-5">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-code-sm text-code-sm uppercase tracking-wider">Signup Burst Window</span>
            <Icon name="timer" className="text-xl" />
          </div>
          <div className="mt-2">
            <div className="text-display-md font-display-md text-on-surface font-bold">
              {ring.temporal?.burst_minutes != null ? formatBurstWindow(ring.temporal.burst_minutes) : "—"}
            </div>
            <div className="font-code-sm text-[12px] text-on-surface-variant/80">Rapid cluster velocity</div>
          </div>
        </div>

        <div className="glass-panel flex flex-col justify-between rounded-xl p-5">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-code-sm text-code-sm uppercase tracking-wider">Referral Cycle</span>
            <Icon name="loop" className="text-xl" />
          </div>
          <div className="mt-2">
            <div className={`text-display-md font-display-md font-bold ${ring.has_referral_cycle ? "text-error" : "text-emerald-400"}`}>
              {ring.has_referral_cycle ? "Detected (Closed Loop)" : "None"}
            </div>
            <div className="font-code-sm text-[12px] text-on-surface-variant/80">Incentive gaming structure</div>
          </div>
        </div>
      </div>

      {/* Main Analysis: Explanation + Graph Subgraph */}
      <div className="grid grid-cols-12 gap-6">
        <div className="glass-panel col-span-12 flex flex-col overflow-hidden rounded-xl lg:col-span-4">
          <div className="flex items-center gap-2 border-b border-outline-variant bg-surface-container-low/50 px-5 py-4">
            <Icon name="insights" className="text-primary" />
            <h3 className="text-title-sm font-title-sm font-semibold text-on-surface">Explaining Signals</h3>
          </div>
          <div className="flex flex-1 flex-col gap-4 p-5">
            <p className="text-body-md font-body-md text-on-surface-variant leading-relaxed">
              {explanation.summary}
            </p>

            <div className="space-y-2">
              <div className="font-code-sm text-[11px] uppercase tracking-wider text-outline font-semibold">
                Contributing Graph Signals
              </div>
              <div className="flex flex-wrap gap-2">
                {(ring.primary_signals || []).map((s) => (
                  <span key={s} className="flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container px-2.5 py-1 font-code-sm text-code-sm text-on-surface">
                    <Icon name={signalIcon(s)} className="text-[14px] text-primary" />
                    {signalLabel(s)}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-auto rounded-lg border border-primary/20 bg-primary/5 p-3.5">
              <div className="font-code-sm text-[11px] font-bold uppercase tracking-wider text-primary">
                Regulatory Decision Snapshot
              </div>
              <p className="mt-1 font-code-sm text-[12px] text-on-surface-variant leading-relaxed">
                Model: RandomForest · Threshold: 0.50 · Evaluated offline on held-out test split.
              </p>
            </div>
          </div>
        </div>

        <div className="glass-panel col-span-12 flex flex-col overflow-hidden rounded-xl lg:col-span-8">
          <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low/50 px-5 py-4">
            <div className="flex items-center gap-2">
              <Icon name="account_tree" className="text-primary" />
              <h3 className="text-title-sm font-title-sm font-semibold text-on-surface">Interactive Subgraph Structure</h3>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {legendItems().map((l) => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                  <span className="font-code-sm text-[11px] text-on-surface-variant">{l.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="relative h-[420px] w-full">
            <CytoscapeComponent cy={(cy) => (cyRef.cy = cy)} {...cyRef} className="h-full w-full" style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      </div>

      {/* Member Accounts List */}
      {ring.members?.length ? (
        <div className="glass-panel rounded-xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="group" className="text-primary" />
              <h3 className="text-title-sm font-title-sm font-semibold text-on-surface">
                {ring.members.length} Ring Member Accounts
              </h3>
            </div>
            <span className="font-code-sm text-[12px] text-on-surface-variant">
              High density entity sharing detected
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {ring.members.map((m) => (
              <span
                key={m}
                className="rounded-lg border border-outline-variant bg-surface-container-lowest/60 px-3 py-1.5 font-code-sm text-code-sm text-on-surface"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Shared Entities & Fragment Scores */}
      <div className="grid grid-cols-12 gap-6">
        <div className="glass-panel col-span-12 rounded-xl p-6 lg:col-span-6">
          <div className="mb-4 flex items-center gap-2">
            <Icon name="devices" className="text-primary" />
            <h3 className="text-title-sm font-title-sm font-semibold text-on-surface">Shared Infrastructure</h3>
          </div>
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant font-medium">Shared Devices</div>
              {(sharedEntities.devices || []).length ? (
                <div className="flex flex-wrap gap-2">
                  {sharedEntities.devices.map((d) => (
                    <span key={d.id} className="rounded-lg border border-[#3b82f6]/30 bg-[#3b82f6]/10 px-3 py-1.5 font-data-mono text-data-mono text-[#9cc4ff]">
                      {d.id} ({d.accounts} accts)
                    </span>
                  ))}
                </div>
              ) : (
                <span className="font-code-sm text-code-sm text-on-surface-variant">None</span>
              )}
            </div>
            <div>
              <div className="mb-1.5 font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant font-medium">Shared IP Addresses</div>
              {(sharedEntities.ips || []).length ? (
                <div className="flex flex-wrap gap-2">
                  {sharedEntities.ips.map((ip) => (
                    <span key={ip.id} className="rounded-lg border border-[#a855f7]/30 bg-[#a855f7]/10 px-3 py-1.5 font-data-mono text-data-mono text-[#d6aef5]">
                      {ip.id} ({ip.accounts} accts)
                    </span>
                  ))}
                </div>
              ) : (
                <span className="font-code-sm text-code-sm text-on-surface-variant">None</span>
              )}
            </div>
          </div>
        </div>

        <div className="glass-panel col-span-12 rounded-xl p-6 lg:col-span-6">
          <div className="mb-4 flex items-center gap-2">
            <Icon name="flag" className="text-primary" />
            <h3 className="text-title-sm font-title-sm font-semibold text-on-surface">Sub-Score Feature Breakdown</h3>
          </div>
          <div className="space-y-3.5">
            {Object.entries(ring.sub_scores || {}).map(([k, v]) => (
              <div key={k}>
                <div className="mb-1 flex justify-between font-code-sm text-code-sm text-on-surface-variant">
                  <span className="capitalize">{k.replace(/_/g, " ")}</span>
                  <span className="font-semibold text-on-surface">{v != null ? (v).toFixed(2) : "—"}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
                  <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${(v || 0) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Analyst Decision Modal */}
      {decisionModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-outline-variant bg-[#11141D] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-outline-variant pb-3">
              <div className="flex items-center gap-2">
                <Icon
                  name={decisionModal.action === "CONFIRM_FRAUD" ? "gpp_bad" : "cancel"}
                  className={decisionModal.action === "CONFIRM_FRAUD" ? "text-error" : "text-outline"}
                />
                <h3 className="text-title-sm font-title-sm font-semibold">
                  {decisionModal.action === "CONFIRM_FRAUD"
                    ? "Confirm Coordinated Fraud Ring"
                    : "Dismiss Ring as False Positive"}
                </h3>
              </div>
              <button onClick={() => setDecisionModal({ open: false, action: null })} className="text-on-surface-variant hover:text-on-surface">
                <Icon name="close" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-body-sm text-on-surface-variant">
                {decisionModal.action === "CONFIRM_FRAUD"
                  ? "This will seal Ring #" + ring.component_id + " as confirmed fraud, isolate member accounts, and record an immutable block to the regulatory audit ledger."
                  : "This will dismiss Ring #" + ring.component_id + " as a legitimate cluster / false positive and record your rationale to the audit chain."}
              </p>

              <div>
                <label className="font-code-sm text-code-sm text-on-surface-variant">
                  Investigator Rationale & Evidence Notes
                </label>
                <textarea
                  rows={3}
                  value={analystNotes}
                  onChange={(e) => setAnalystNotes(e.target.value)}
                  placeholder="e.g., Confirmed synthetic device identity farm across shared subnet..."
                  className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 font-sans text-body-sm text-on-surface focus:border-primary outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDecisionModal({ open: false, action: null })}
                className="rounded-lg border border-outline-variant px-4 py-2 text-body-sm hover:bg-surface-container-high"
              >
                Cancel
              </button>
              <button
                onClick={handleDecisionSubmit}
                disabled={submitting}
                className={`flex items-center gap-2 rounded-lg px-5 py-2 text-body-sm font-medium text-white ${
                  decisionModal.action === "CONFIRM_FRAUD" ? "bg-error hover:bg-error/90" : "bg-surface-container-highest hover:bg-surface-container-high text-on-surface"
                }`}
              >
                {submitting ? <Icon name="sync" className="animate-spin" /> : <Icon name="lock" />}
                Submit & Seal Decision
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
