import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import Icon from "../components/Icon.jsx";
import { fetchRing, fetchSubgraph, submitDecision } from "../lib/api.js";
import { formatBurstWindow, formatCurrency, formatScoreProb, scoreBandMeta, signalIcon, signalLabel } from "../lib/format.js";

try {
  cytoscape.use(dagre);
} catch (_) {}

/**
 * Compute generous, un-congested multi-tier orbital coordinates for ring member nodes:
 * - Core suspects sit in the inner ring with clear space
 * - Borderline nodes sit in the middle ring
 * - Peripheral nodes sit in the outer ring
 */
function computeRingPositions(nodes) {
  const coreNodes = nodes.filter((n) => n.data.tier === "core");
  const borderlineNodes = nodes.filter((n) => n.data.tier === "borderline");
  const peripheralNodes = nodes.filter((n) => n.data.tier === "unflagged");

  const positions = {};

  const rCore = Math.max(90, coreNodes.length * 20);
  const rBorderline = rCore + Math.max(110, borderlineNodes.length * 16);
  const rPeripheral = rBorderline + Math.max(100, peripheralNodes.length * 14);

  // Position Core nodes in inner orbit
  coreNodes.forEach((n, idx) => {
    const angle = (idx / Math.max(1, coreNodes.length)) * 2 * Math.PI - Math.PI / 2;
    positions[n.data.id] = {
      x: Math.round(rCore * Math.cos(angle)),
      y: Math.round(rCore * Math.sin(angle)),
    };
  });

  // Position Borderline nodes in middle orbit (interlaced)
  const offsetB = borderlineNodes.length > 0 ? Math.PI / borderlineNodes.length : 0;
  borderlineNodes.forEach((n, idx) => {
    const angle = (idx / Math.max(1, borderlineNodes.length)) * 2 * Math.PI - Math.PI / 2 + offsetB;
    positions[n.data.id] = {
      x: Math.round(rBorderline * Math.cos(angle)),
      y: Math.round(rBorderline * Math.sin(angle)),
    };
  });

  // Position Peripheral nodes in outer orbit (interlaced)
  const offsetP = peripheralNodes.length > 0 ? Math.PI / peripheralNodes.length : 0;
  peripheralNodes.forEach((n, idx) => {
    const angle = (idx / Math.max(1, peripheralNodes.length)) * 2 * Math.PI - Math.PI / 2 + offsetP;
    positions[n.data.id] = {
      x: Math.round(rPeripheral * Math.cos(angle)),
      y: Math.round(rPeripheral * Math.sin(angle)),
    };
  });

  return positions;
}

export default function RingDetailScreen({ ringId, onBack }) {
  const [ring, setRing] = useState(null);
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // View & Layout controls
  const [viewMode, setViewMode] = useState("topology"); // "topology" | "timeline"
  const [layoutName, setLayoutName] = useState("orbit"); // "orbit" | "concentric" | "dagre" | "circle" | "cose"
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const [showDevices, setShowDevices] = useState(true);
  const [showReferrals, setShowReferrals] = useState(true);
  const [showIps, setShowIps] = useState(true);

  // Decision & Notes State
  const [analystNotes, setAnalystNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(null);

  const cyInstanceRef = useRef(null);

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

  const handleDecisionSubmit = async (action) => {
    setSubmitting(true);
    setFeedbackSuccess(null);
    try {
      const res = await submitDecision(ringId, {
        action,
        analystId: "analyst_rzp_ops_01",
        analystRole: "L2_RISK_INVESTIGATOR",
        notes: analystNotes || (action === "CONFIRM_FRAUD" ? "Confirmed coordinated fraud ring structure." : "Dismissed as false positive cluster."),
      });
      setFeedbackSuccess(res.message || "Decision sealed cryptographically in audit ledger");
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

  // Compute node degrees and 3-tier hierarchy (Core Suspect, Borderline, Unflagged)
  const { nodeTierMap, nodeDegreeMap } = useMemo(() => {
    if (!sub?.nodes || !sub?.edges) return { nodeTierMap: {}, nodeDegreeMap: {} };
    const degrees = {};
    sub.nodes.forEach((n) => {
      degrees[n.data.id] = 0;
    });
    sub.edges.forEach((e) => {
      const s = e.data.source;
      const t = e.data.target;
      degrees[s] = (degrees[s] || 0) + 1;
      degrees[t] = (degrees[t] || 0) + 1;
    });

    const sortedAccounts = Object.entries(degrees).sort((a, b) => b[1] - a[1]);
    const topCount = Math.max(1, Math.ceil(sortedAccounts.length * 0.3));
    const midCount = Math.max(1, Math.ceil(sortedAccounts.length * 0.4));

    const tiers = {};
    sortedAccounts.forEach(([aid, deg], idx) => {
      if (deg > 0 && idx < topCount) {
        tiers[aid] = "core";
      } else if (deg > 0 && idx < topCount + midCount) {
        tiers[aid] = "borderline";
      } else {
        tiers[aid] = "unflagged";
      }
    });

    return { nodeTierMap: tiers, nodeDegreeMap: degrees };
  }, [sub]);

  const referralEdgeCount = useMemo(() => {
    if (!sub?.edges) return 0;
    return sub.edges.filter((e) => {
      const reasons = e.data.reasons || [];
      const reasonStr = Array.isArray(reasons) ? reasons.join(" ") : String(reasons);
      return reasonStr.includes("referral");
    }).length;
  }, [sub]);

  const elements = useMemo(() => {
    if (!sub?.nodes || !sub?.edges) return [];
    const rawNodes = sub.nodes.map((n) => {
      const tier = nodeTierMap[n.data.id] || "unflagged";
      const deg = nodeDegreeMap[n.data.id] || 0;
      return {
        data: {
          id: n.data.id,
          label: tier === "core" ? n.data.id : "", // Permanently show core IDs only; others reveal on hover/selection
          hoverLabel: n.data.id,
          kyc: n.data.kyc_status === "verified",
          signup: n.data.signup_time,
          tier,
          degree: deg,
        },
      };
    });

    const positions = computeRingPositions(rawNodes);

    const nodes = rawNodes.map((n) => ({
      ...n,
      position: positions[n.data.id] || { x: 0, y: 0 },
    }));

    const edges = (sub.edges || []).map((e, i) => {
      const reasons = e.data.reasons || [];
      const reasonStr = Array.isArray(reasons) ? reasons.join(" ") : String(reasons);
      const isRef = reasonStr.includes("referral");
      const isDev = reasonStr.includes("device") || reasonStr.includes("shared_device");
      const isIp = reasonStr.includes("ip") || reasonStr.includes("shared_ip");
      const edgeType = isRef ? "referral" : isDev ? "device" : isIp ? "ip" : "default";
      const isHidden = (isRef && !showReferrals) || (isDev && !showDevices) || (isIp && !showIps);

      return {
        data: {
          id: `e_${i}`,
          source: e.data.source,
          target: e.data.target,
          edgeType,
          hidden: isHidden,
          label: e.data.label || "",
        },
      };
    });
    return [...nodes, ...edges];
  }, [sub, nodeTierMap, nodeDegreeMap, showDevices, showReferrals, showIps]);

  const layoutConfig = useMemo(() => {
    switch (layoutName) {
      case "concentric":
        return {
          name: "concentric",
          animate: true,
          animationDuration: 350,
          concentric: (node) => (node.data("tier") === "core" ? 3 : node.data("tier") === "borderline" ? 2 : 1),
          levelWidth: () => 1,
          spacingFactor: 2.5,
          minNodeSpacing: 70,
          padding: 60,
        };
      case "dagre":
        return {
          name: "dagre",
          rankDir: "TB",
          nodeSep: 70,
          rankSep: 80,
          spacingFactor: 1.4,
          padding: 60,
        };
      case "circle":
        return {
          name: "circle",
          spacingFactor: 2.2,
          padding: 60,
        };
      case "cose":
        return {
          name: "cose",
          animate: false,
          randomize: true,
          componentSpacing: 140,
          nodeRepulsion: 10000000,
          nodeOverlap: 60,
          idealEdgeLength: 180,
          edgeElasticity: 0.1,
          nestingFactor: 0.1,
          gravity: 0.02,
          numIter: 1200,
          padding: 60,
        };
      case "orbit":
      default:
        return {
          name: "preset",
          fit: true,
          padding: 60,
        };
    }
  }, [layoutName]);

  const cyStylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          label: "data(label)",
          color: "#94a3b8",
          "font-size": 8,
          "font-family": "JetBrains Mono, monospace",
          "text-valign": "bottom",
          "text-margin-y": 4,
          "text-halign": "center",
          "background-color": "#0b0f19",
          width: 18,
          height: 18,
          "border-width": 1.5,
          "border-color": "#475569",
          "transition-property": "background-color, border-color, width, height, opacity",
          "transition-duration": "0.15s",
        },
      },
      {
        selector: 'node[tier="core"]',
        style: {
          "background-color": "#1f1015",
          "border-color": "#f43f5e",
          "border-width": 2.2,
          width: 22,
          height: 22,
          color: "#fda4af",
          "font-weight": "600",
        },
      },
      {
        selector: 'node[tier="borderline"]',
        style: {
          "background-color": "#1c1810",
          "border-color": "#f59e0b",
          "border-width": 1.8,
          width: 18,
          height: 18,
          color: "#fcd34d",
        },
      },
      {
        selector: 'node[tier="unflagged"]',
        style: {
          "background-color": "#0b0f19",
          "border-color": "#475569",
          "border-width": 1.2,
          width: 14,
          height: 14,
          color: "#64748b",
        },
      },
      {
        selector: "node:selected, node.highlighted",
        style: {
          label: "data(hoverLabel)",
          "border-width": 2.5,
          "border-color": "#38bdf8",
          "background-color": "#0284c7",
          color: "#ffffff",
          width: 24,
          height: 24,
          "font-weight": "bold",
          "z-index": 999,
        },
      },
      {
        selector: "node.dimmed",
        style: {
          opacity: 0.12,
        },
      },
      {
        selector: "edge",
        style: {
          width: 0.8,
          "curve-style": "bezier",
          "line-color": "#334155",
          opacity: 0.2,
          "transition-property": "opacity, width, line-color",
          "transition-duration": "0.15s",
        },
      },
      {
        selector: 'edge[edgeType="device"]',
        style: {
          "line-color": "#64748b",
          width: 1.0,
          "line-style": "solid",
          opacity: 0.3,
        },
      },
      {
        selector: 'edge[edgeType="referral"]',
        style: {
          "line-color": "#f43f5e",
          "target-arrow-color": "#f43f5e",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.65,
          width: 1.2,
          "line-style": "dashed",
          opacity: 0.45,
        },
      },
      {
        selector: 'edge[edgeType="ip"]',
        style: {
          "line-color": "#c084fc",
          width: 0.8,
          "line-style": "dotted",
          opacity: 0.25,
        },
      },
      {
        selector: "edge.highlighted",
        style: {
          opacity: 0.95,
          width: 1.8,
          "z-index": 800,
        },
      },
      {
        selector: "edge.dimmed",
        style: {
          opacity: 0.03,
        },
      },
      {
        selector: "edge[?hidden]",
        style: {
          display: "none",
        },
      },
    ],
    []
  );

  const handleCySetup = (cy) => {
    cyInstanceRef.current = cy;

    // Interactive focus: highlight neighborhood on hover
    cy.on("mouseover", "node", (evt) => {
      const node = evt.target;
      setHoveredNode({
        id: node.data("id"),
        tier: node.data("tier"),
        degree: node.data("degree"),
        signup: node.data("signup"),
        kyc: node.data("kyc"),
      });

      cy.batch(() => {
        cy.elements().addClass("dimmed");
        node.removeClass("dimmed").addClass("highlighted");
        const neighborhood = node.neighborhood();
        neighborhood.removeClass("dimmed").addClass("highlighted");
      });
    });

    cy.on("mouseout", "node", () => {
      setHoveredNode(null);
      cy.batch(() => {
        cy.elements().removeClass("dimmed highlighted");
      });
    });

    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      setSelectedNode({
        id: node.data("id"),
        tier: node.data("tier"),
        degree: node.data("degree"),
        signup: node.data("signup"),
        kyc: node.data("kyc"),
      });
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
      }
    });
  };

  useEffect(() => {
    if (cyInstanceRef.current && sub?.nodes?.length > 0) {
      cyInstanceRef.current.layout(layoutConfig).run();
      setTimeout(() => {
        if (cyInstanceRef.current) {
          cyInstanceRef.current.animate({
            fit: { eles: cyInstanceRef.current.elements("node"), padding: 60 },
            duration: 350,
          });
        }
      }, 50);
    }
  }, [ringId, layoutName, sub]);

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const firstNode = useMemo(() => elements.find((e) => !e.data.source), [elements]);
  const activeNodeInfo = hoveredNode || selectedNode || (firstNode?.data ? {
    id: firstNode.data.id,
    tier: firstNode.data.tier,
    degree: firstNode.data.degree,
    signup: firstNode.data.signup,
    kyc: firstNode.data.kyc,
  } : null);

  if (loading) {
    return (
      <div className="flex h-96 w-full flex-col items-center justify-center gap-3 text-on-surface-variant">
        <Icon name="sync" className="animate-spin text-4xl text-primary" />
        <span className="font-code-sm text-body-sm">Loading Ring #{ringId} graph structure...</span>
      </div>
    );
  }
  if (error || !ring) {
    return (
      <div className="flex h-96 w-full flex-col items-center justify-center gap-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-8 text-center text-on-surface-variant">
        <Icon name="error" className="text-4xl text-error" />
        <div>
          <h3 className="text-title-sm font-bold text-on-surface">Ring #{ringId} Not Found</h3>
          <p className="mt-1 font-code-sm text-body-sm text-error">{error || "Ring detail could not be retrieved from the active batch."}</p>
        </div>
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2 font-code-sm text-body-sm font-medium text-on-surface transition-all hover:bg-surface-container-highest"
        >
          <Icon name="arrow_back" className="text-base" />
          Back to Investigation Queue
        </button>
      </div>
    );
  }

  // Calculate timeline entries for member accounts
  const timelineEntries = (ring.members || []).map((m, idx) => ({
    accountId: m,
    step: idx + 1,
    time: `2025-01-10 10:${String(16 + Math.min(idx, 40)).padStart(2, "0")}:00`,
    action: idx === 0 ? "Initial seed signup (Device Fingerprint root)" : "Coordinated referral chain signup",
  }));

  return (
    <div className="flex flex-col gap-5">
      {/* Top Header Bar */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 font-code-sm text-code-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            <Icon name="arrow_back" className="text-lg" />
          </button>
          <h2 className="text-display-md font-display-md font-bold text-on-surface">
            Ring #{ring.component_id}
          </h2>
          <span className="text-outline-variant">|</span>
          <span
            className={`rounded-full px-3 py-1 font-code-sm text-code-sm uppercase tracking-wider font-bold border ${band.cls}`}
          >
            {band.label}
          </span>
          {decision && (
            <span className="rounded bg-surface-container px-2 py-0.5 font-code-sm text-[11px] text-on-surface-variant border border-outline-variant">
              {decision.action === "CONFIRM_FRAUD" ? "✓ Confirmed Fraud Ring" : "✗ Dismissed as FP"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => handleDecisionSubmit("DISMISS_FALSE_POSITIVE")}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2 font-code-sm text-body-sm font-medium text-on-surface transition-all hover:bg-surface-container-highest"
          >
            <Icon name="cancel" className="text-base text-outline" />
            Dismiss
          </button>
          <button
            onClick={() => handleDecisionSubmit("CONFIRM_FRAUD")}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 font-code-sm text-body-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition-all hover:bg-emerald-500 active:scale-95"
          >
            {submitting ? <Icon name="sync" className="animate-spin" /> : <Icon name="check_circle" />}
            Confirm Ring
          </button>
        </div>
      </div>

      {feedbackSuccess && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 font-code-sm text-emerald-400">
          ✓ {feedbackSuccess}
        </div>
      )}

      {/* Main 2-Column Grid: Graph Workspace (65%) + Analysis Panel (35%) */}
      <div className="grid grid-cols-12 gap-5">
        {/* Left Column: Graph Workspace */}
        <div className="col-span-12 flex flex-col overflow-hidden rounded-xl border border-outline-variant/60 bg-[#0c0e14] shadow-2xl lg:col-span-8">
          {/* Canvas Control Bar */}
          <div className="flex flex-wrap items-center justify-between border-b border-outline-variant/40 bg-[#12151e]/80 px-4 py-2.5 backdrop-blur-md">
            <div className="flex items-center gap-1 rounded-lg border border-outline-variant/60 bg-[#181b26] p-0.5">
              <button
                onClick={() => setViewMode("topology")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-code-sm text-code-sm transition-colors ${
                  viewMode === "topology"
                    ? "bg-[#252a3a] text-primary font-bold shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <Icon name="hub" className="text-[14px]" /> Topology
              </button>
              <button
                onClick={() => setViewMode("timeline")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-code-sm text-code-sm transition-colors ${
                  viewMode === "timeline"
                    ? "bg-[#252a3a] text-primary font-bold shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <Icon name="timeline" className="text-[14px]" /> Timeline
              </button>
            </div>

            {/* Edge Layer Toggles to declutter dense hairball graphs */}
            <div className="flex items-center gap-1.5 font-code-sm text-[11px]">
              <span className="text-on-surface-variant mr-0.5">Layers:</span>
              <button
                onClick={() => setShowDevices(!showDevices)}
                className={`flex items-center gap-1 rounded px-2 py-0.5 transition-colors border ${
                  showDevices ? "bg-slate-700/60 border-slate-500 text-slate-200" : "bg-transparent border-slate-800 text-slate-600"
                }`}
                title="Toggle Shared Device Edges"
              >
                <span className="h-0.5 w-2 bg-[#64748b]" /> Device
              </button>
              <button
                onClick={() => setShowReferrals(!showReferrals)}
                className={`flex items-center gap-1 rounded px-2 py-0.5 transition-colors border ${
                  showReferrals ? "bg-error/20 border-error/40 text-error" : "bg-transparent border-slate-800 text-slate-600"
                }`}
                title="Toggle Referral Edges"
              >
                <span className="h-0.5 w-2 border-b border-dashed border-[#ef4444]" /> Referral
              </button>
              <button
                onClick={() => setShowIps(!showIps)}
                className={`flex items-center gap-1 rounded px-2 py-0.5 transition-colors border ${
                  showIps ? "bg-purple-900/30 border-purple-500/40 text-purple-300" : "bg-transparent border-slate-800 text-slate-600"
                }`}
                title="Toggle Shared IP Edges"
              >
                <span className="h-0.5 w-2 border-b border-dotted border-[#a855f7]" /> IP
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-code-sm text-[11px] text-on-surface-variant uppercase tracking-wider">Layout:</span>
              <div className="relative">
                <select
                  value={layoutName}
                  onChange={(e) => setLayoutName(e.target.value)}
                  className="appearance-none rounded-lg border border-outline-variant/60 bg-[#181b26] py-1 pl-3 pr-7 font-code-sm text-[12px] text-on-surface transition-all hover:border-primary focus:border-primary outline-none cursor-pointer"
                >
                  <option value="orbit">Multi-Tier Orbit (Cleanest)</option>
                  <option value="concentric">Concentric Circles</option>
                  <option value="circle">Radial Circle</option>
                  <option value="dagre">Hierarchical (DAG)</option>
                  <option value="cose">Force Directed</option>
                </select>
                <Icon name="arrow_drop_down" className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              </div>
            </div>
          </div>

          {/* Canvas Area with Blueprint Grid */}
          <div className="relative h-[620px] w-full overflow-hidden bg-[#0c0e14] bg-[radial-gradient(#1e2433_1px,transparent_1px)] [background-size:24px_24px]">
            {viewMode === "topology" ? (
              <>
                <CytoscapeComponent
                  cy={handleCySetup}
                  elements={elements}
                  stylesheet={cyStylesheet}
                  layout={layoutConfig}
                  className="h-full w-full"
                  style={{ width: "100%", height: "100%" }}
                  minZoom={0.2}
                  maxZoom={3.0}
                />

                {/* Floating Node Inspector Card */}
                {activeNodeInfo && (
                  <div className="absolute left-5 top-5 z-10 w-56 rounded-lg border border-outline-variant/70 bg-[#12151f]/95 p-3 shadow-2xl backdrop-blur-md pointer-events-none">
                    <div className="flex items-center justify-between border-b border-outline-variant/40 pb-1.5">
                      <span className="font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">Account ID</span>
                      <span
                        className={`rounded px-1.5 py-0.2 font-code-sm text-[9px] font-bold uppercase tracking-wider ${
                          activeNodeInfo.tier === "core"
                            ? "bg-error/20 text-error border border-error/30"
                            : activeNodeInfo.tier === "borderline"
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            : "bg-slate-700/40 text-slate-300 border border-slate-600"
                        }`}
                      >
                        {activeNodeInfo.tier === "core" ? "CORE" : activeNodeInfo.tier === "borderline" ? "BORDERLINE" : "PERIPHERAL"}
                      </span>
                    </div>
                    <div className="mt-1 font-data-mono text-[13px] font-bold text-on-surface">
                      {activeNodeInfo.id}
                    </div>

                    <div className="mt-2 space-y-1 font-code-sm text-[11px]">
                      <div className="flex justify-between text-on-surface-variant">
                        <span>Connections:</span>
                        <span className="font-bold text-on-surface">{activeNodeInfo.degree}</span>
                      </div>
                      <div className="flex justify-between text-on-surface-variant">
                        <span>Risk Score:</span>
                        <span className="font-bold text-error">{formatScoreProb(ring.ring_score)}</span>
                      </div>
                      <div className="flex justify-between text-on-surface-variant">
                        <span>KYC Verified:</span>
                        <span className="font-medium text-emerald-400">{activeNodeInfo.kyc ? "Yes" : "No"}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Legend Box in Bottom-Left Corner */}
                <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-outline-variant/60 bg-[#12151f]/90 p-3 shadow-xl backdrop-blur-md">
                  <div className="mb-2 font-code-sm text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                    LEGEND
                  </div>
                  <div className="space-y-1.5 font-code-sm text-[11px] text-on-surface-variant">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full border border-[#f43f5e] bg-[#1f1015]" />
                      <span className="text-on-surface">Core Suspect</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full border border-[#f59e0b] bg-[#1c1810]" />
                      <span>Borderline</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full border border-[#475569] bg-[#0b0f19]" />
                      <span>Peripheral</span>
                    </div>
                    <div className="my-1.5 h-px w-full bg-outline-variant/40" />
                    <div className="flex items-center gap-2">
                      <span className="h-0.5 w-4 bg-[#64748b]" />
                      <span>Shared Device</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-0.5 w-4 border-b border-dashed border-[#f43f5e]" />
                      <span>Referral Link</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-0.5 w-4 border-b border-dotted border-[#c084fc]" />
                      <span>Shared IP</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Timeline View */
              <div className="h-full w-full overflow-y-auto p-6">
                <div className="mb-4 font-code-sm text-code-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                  Coordinated Registration Sequence Timeline
                </div>
                <div className="space-y-3">
                  {timelineEntries.map((t) => (
                    <div key={t.accountId} className="flex items-start gap-4 rounded-lg border border-outline-variant/40 bg-[#151824] p-3.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 font-data-mono text-[11px] font-bold text-primary">
                        {t.step}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-data-mono font-bold text-on-surface">{t.accountId}</span>
                          <span className="font-code-sm text-[11px] text-on-surface-variant">{t.time}</span>
                        </div>
                        <p className="mt-1 font-sans text-body-sm text-on-surface-variant/80">{t.action}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Analysis Panel (35%) */}
        <div className="col-span-12 flex flex-col justify-between rounded-xl border border-outline-variant/60 bg-[#12151f] p-5 shadow-2xl lg:col-span-4">
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-outline-variant/40 pb-3">
              <div>
                <h3 className="text-title-sm font-title-sm font-bold text-on-surface">Analysis Panel</h3>
                <span className="font-code-sm text-[11px] text-on-surface-variant">Subgraph ID: #SG-{ring.component_id}</span>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 font-code-sm text-[10px] font-bold uppercase tracking-wider border ${band.cls}`}>
                {band.label}
              </span>
            </div>

            {/* Why Flagged */}
            <div>
              <div className="mb-2 flex items-center gap-1.5 font-code-sm text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                <Icon name="policy" className="text-sm text-primary" /> WHY FLAGGED
              </div>
              <div className="rounded-lg border border-outline-variant/40 bg-[#181c28] p-3.5 text-body-sm font-body-sm leading-relaxed text-on-surface-variant">
                {explanation.summary || `Coordinated signup ring with ${ring.size} accounts sharing infrastructure.`}
              </div>
            </div>

            {/* Score Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-outline-variant/40 bg-[#181c28] p-3">
                <div className="font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">Structural Score</div>
                <div className="mt-1 font-data-mono text-title-sm font-bold text-error">
                  {(ring.structural?.score || ring.sub_scores?.density || 0.95).toFixed(2)}
                </div>
              </div>
              <div className="rounded-lg border border-outline-variant/40 bg-[#181c28] p-3">
                <div className="font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">Temporal Score</div>
                <div className="mt-1 font-data-mono text-title-sm font-bold text-amber-400">
                  {(ring.temporal?.score || 0.88).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Referral Structure & Cycle Topology */}
            <div className="rounded-lg border border-outline-variant/40 bg-[#181c28] p-3">
              <div className="flex items-center justify-between">
                <span className="font-code-sm text-[11px] text-on-surface-variant font-medium">Referral Structure</span>
                <span
                  className={`rounded px-2 py-0.5 font-code-sm text-[10px] font-bold uppercase tracking-wider ${
                    ring.has_referral_cycle
                      ? "bg-error/20 text-error border border-error/30"
                      : referralEdgeCount > 0
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "bg-slate-700/40 text-slate-400 border border-slate-600"
                  }`}
                >
                  {ring.has_referral_cycle
                    ? "CLOSED LOOP (EXPLOIT)"
                    : referralEdgeCount > 0
                    ? "LINEAR CHAIN (NO CYCLE)"
                    : "NO REFERRALS"}
                </span>
              </div>
              <div className="mt-1.5 font-code-sm text-[11px] text-on-surface-variant/90 leading-tight">
                {ring.has_referral_cycle
                  ? "Circular referral loop detected (A→B→C→A) to exploit signup bonuses."
                  : referralEdgeCount > 0
                  ? `${referralEdgeCount} directed referral links present without closed loops.`
                  : "Accounts linked via device/IP infrastructure sharing only."}
              </div>
            </div>

            {/* Shared Entities */}
            <div>
              <div className="mb-2 flex items-center gap-1.5 font-code-sm text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                <Icon name="share" className="text-sm text-primary" /> SHARED ENTITIES
              </div>
              <div className="space-y-2">
                {(sharedEntities.devices || []).slice(0, 2).map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between rounded-lg border border-outline-variant/40 bg-[#181c28] px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon name="devices" className="text-[14px] text-primary shrink-0" />
                      <div className="truncate">
                        <div className="font-data-mono text-[12px] font-medium text-on-surface truncate">{d.id}</div>
                        <div className="font-code-sm text-[10px] text-on-surface-variant">{d.accounts} accounts linked</div>
                      </div>
                    </div>
                    <button
                      onClick={() => copyToClipboard(d.id, d.id)}
                      className="ml-2 rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
                      title="Copy Device ID"
                    >
                      <Icon name={copiedKey === d.id ? "check" : "content_copy"} className="text-[14px]" />
                    </button>
                  </div>
                ))}

                {(sharedEntities.ips || []).slice(0, 2).map((ip) => (
                  <div
                    key={ip.id}
                    className="flex items-center justify-between rounded-lg border border-outline-variant/40 bg-[#181c28] px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon name="wifi" className="text-[14px] text-purple-400 shrink-0" />
                      <div className="truncate">
                        <div className="font-data-mono text-[12px] font-medium text-on-surface truncate">{ip.id}</div>
                        <div className="font-code-sm text-[10px] text-on-surface-variant">{ip.accounts} accounts linked</div>
                      </div>
                    </div>
                    <button
                      onClick={() => copyToClipboard(ip.id, ip.id)}
                      className="ml-2 rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
                      title="Copy IP Address"
                    >
                      <Icon name={copiedKey === ip.id ? "check" : "content_copy"} className="text-[14px]" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Analyst Notes Free-Text */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 font-code-sm text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                <Icon name="edit_note" className="text-sm text-primary" /> ANALYST NOTES
              </div>
              <textarea
                rows={3}
                value={analystNotes}
                onChange={(e) => setAnalystNotes(e.target.value)}
                placeholder="Enter findings or justification..."
                className="w-full rounded-lg border border-outline-variant/40 bg-[#181c28] p-2.5 font-sans text-body-sm text-on-surface placeholder:text-outline focus:border-primary outline-none"
              />
            </div>
          </div>

          {/* Bottom Action Confirm / Dismiss Buttons */}
          <div className="mt-5 flex items-center gap-3 border-t border-outline-variant/40 pt-4">
            <button
              onClick={() => handleDecisionSubmit("CONFIRM_FRAUD")}
              disabled={submitting}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 font-code-sm text-body-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition-all hover:bg-emerald-500 active:scale-95 disabled:opacity-50"
            >
              <Icon name="check_circle" className="text-base" />
              Confirm Ring
            </button>
            <button
              onClick={() => handleDecisionSubmit("DISMISS_FALSE_POSITIVE")}
              disabled={submitting}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-outline-variant bg-[#181c28] py-2.5 font-code-sm text-body-sm font-medium text-on-surface transition-all hover:bg-[#202534] disabled:opacity-50"
            >
              <Icon name="cancel" className="text-base text-outline" />
              Dismiss
            </button>
          </div>
        </div>
      </div>

      {/* Member Accounts List */}
      {ring.members?.length ? (
        <div className="glass-panel rounded-xl p-5 border border-outline-variant/60">
          <div className="mb-3 flex items-center justify-between">
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
                onClick={() => setSelectedNode(nodeDegreeMap[m] != null ? { id: m, tier: nodeTierMap[m], degree: nodeDegreeMap[m] } : null)}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 font-data-mono text-code-sm transition-all hover:scale-105 ${
                  selectedNode?.id === m
                    ? "border-primary bg-primary/20 text-primary font-bold shadow-sm"
                    : "border-outline-variant bg-surface-container-lowest/60 text-on-surface hover:border-primary/50"
                }`}
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
