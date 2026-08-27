import { useEffect, useMemo, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import Icon from "../components/Icon.jsx";
import { fetchRing, fetchSubgraph } from "../lib/api.js";
import { formatBurstWindow } from "../lib/format.js";

cytoscape.use(dagre);

const STATUS_LABELS = { flagged: "Ring Detected", needs_review: "Needs Review" };

function legendItems() {
  return [
    { color: "#ef4444", label: "Referral Edge" },
    { color: "#3b82f6", label: "Shared Device" },
    { color: "#a855f7", label: "Shared IP" },
    { color: "#10b981", label: "Member" },
  ];
}

export default function RingDetailScreen({ ringId, onBack }) {
  const [ring, setRing] = useState(null);
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchRing(ringId), fetchSubgraph(ringId)])
      .then(([r, s]) => {
        if (cancelled) return;
        setRing(r);
        setSub(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Failed to load ring");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ringId]);

  const explanation = useMemo(() => ring?.explanation || {}, [ring]);
  const sharedEntities = useMemo(() => ring?.shared_entities || {}, [ring]);

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
    <div className="flex flex-col gap-gutter">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={onBack}
            className="mb-3 flex items-center gap-1 font-code-sm text-code-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            <Icon name="chevron_left" className="text-[16px]" /> Back to rings
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-display-lg font-display-lg text-on-surface">{ring.component_id}</h2>
            <span
              className={`rounded-full px-3 py-1 font-code-sm text-code-sm uppercase tracking-wider ${
                ring.status === "flagged" ? "bg-error/15 text-error border border-error/20" : "bg-tertiary/15 text-tertiary border border-tertiary/20"
              }`}
            >
              {STATUS_LABELS[ring.status] || ring.status}
            </span>
          </div>
          <p className="mt-1 font-code-sm text-code-sm text-on-surface-variant">
            Detected {ring.detected_at ? new Date(ring.detected_at).toLocaleString() : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-display-lg font-display-lg text-error">{Math.round((ring.ring_score || 0) * 100)}</div>
          <div className="font-code-sm text-code-sm text-on-surface-variant">RING SCORE</div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-gutter">
        <div className="glass-panel col-span-12 flex flex-col overflow-hidden rounded-xl lg:col-span-4">
          <div className="flex items-center gap-2 border-b border-outline-variant bg-surface-container-low/50 px-5 py-4">
            <Icon name="insights" className="text-primary" />
            <h3 className="text-title-sm font-title-sm text-on-surface">Explanation</h3>
          </div>
          <div className="flex flex-1 flex-col gap-4 p-5">
            <p className="text-body-md font-body-md text-on-surface-variant">{explanation.summary}</p>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest/40 p-3">
                <div className="text-title-sm font-title-sm text-error">{Math.round((explanation.ring_score || ring.ring_score || 0) * 100)}</div>
                <div className="font-code-sm text-code-sm text-on-surface-variant">Score</div>
              </div>
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest/40 p-3">
                <div className="text-title-sm font-title-sm text-tertiary">
                  {ring.temporal?.burst_minutes != null ? formatBurstWindow(ring.temporal.burst_minutes) : "—"}
                </div>
                <div className="font-code-sm text-code-sm text-on-surface-variant">Burst Window</div>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-tertiary/20 bg-tertiary/10 p-3">
              <Icon name="account_tree" className="mt-0.5 text-tertiary" />
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                Referral cycle {ring.has_referral_cycle ? "present" : "not detected"} — rings may form closed loops to game referral rewards.
              </span>
            </div>
          </div>
        </div>

        <div className="glass-panel col-span-12 flex flex-col overflow-hidden rounded-xl lg:col-span-8">
          <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low/50 px-5 py-4">
            <div className="flex items-center gap-2">
              <Icon name="account_tree" className="text-primary" />
              <h3 className="text-title-sm font-title-sm text-on-surface">Ring Structure</h3>
            </div>
            <div className="flex items-center gap-3">
              {legendItems().map((l) => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                  <span className="font-code-sm text-code-sm text-on-surface-variant">{l.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="relative h-[400px] w-full">
            <CytoscapeComponent cy={(cy) => (cyRef.cy = cy)} {...cyRef} className="h-full w-full" style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      </div>

      {ring.members?.length ? (
        <div className="glass-panel rounded-xl p-6">
          <div className="mb-4 flex items-center gap-2">
            <Icon name="group" className="text-primary" />
            <h3 className="text-title-sm font-title-sm text-on-surface">
              {ring.members.length} Ring Members
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {ring.members.map((m) => (
              <span
                key={m}
                className="rounded-lg border border-outline-variant bg-surface-container-lowest/40 px-3 py-1.5 font-code-sm text-code-sm text-on-surface-variant"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-12 gap-gutter">
        <div className="glass-panel col-span-12 rounded-xl p-6 lg:col-span-6">
          <div className="mb-4 flex items-center gap-2">
            <Icon name="devices" className="text-primary" />
            <h3 className="text-title-sm font-title-sm text-on-surface">Shared Entities</h3>
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">Devices</div>
              {(sharedEntities.devices || []).length ? (
                <div className="flex flex-wrap gap-2">
                  {sharedEntities.devices.map((d) => (
                    <span key={d.id} className="rounded-lg border border-[#3b82f6]/30 bg-[#3b82f6]/10 px-3 py-1.5 font-data-mono text-data-mono text-[#9cc4ff]">
                      {d.id}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="font-code-sm text-code-sm text-on-surface-variant">None</span>
              )}
            </div>
            <div>
              <div className="mb-1 font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">IP Addresses</div>
              {(sharedEntities.ips || []).length ? (
                <div className="flex flex-wrap gap-2">
                  {sharedEntities.ips.map((ip) => (
                    <span key={ip.id} className="rounded-lg border border-[#a855f7]/30 bg-[#a855f7]/10 px-3 py-1.5 font-data-mono text-data-mono text-[#d6aef5]">
                      {ip.id}
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
            <h3 className="text-title-sm font-title-sm text-on-surface">Fragment Score</h3>
          </div>
          <div className="space-y-3">
            {Object.entries(ring.sub_scores || {}).map(([k, v]) => (
              <div key={k}>
                <div className="mb-1 flex justify-between font-code-sm text-code-sm text-on-surface-variant">
                  <span className="capitalize">{k}</span>
                  <span>{v != null ? Math.round(v * 100) : "—"}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(v || 0) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
