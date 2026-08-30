import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import Icon from "../components/Icon.jsx";
import { fetchGlobalGraph } from "../lib/api.js";
import { formatScoreProb } from "../lib/format.js";

try {
  cytoscape.use(dagre);
} catch (_) {}

/**
 * Compute organic positions for 500 nodes such that:
 * 1. Major fraud clusters (Ring #26, #121, #211, #1) form tight, distinct focal syndicates.
 * 2. Small legitimate groups (pairs/triads) form visible shared-infrastructure links.
 * 3. Organic singletons disperse naturally in a wide celestial sunflower field with natural jitter.
 */
function computeOrganicPositions(nodes, edges) {
  const adj = {};
  nodes.forEach((n) => {
    adj[n.data.id] = [];
  });
  edges.forEach((e) => {
    const s = e.data.source;
    const t = e.data.target;
    if (adj[s]) adj[s].push(t);
    if (adj[t]) adj[t].push(s);
  });

  // Connected Components via BFS
  const visited = new Set();
  const components = [];

  nodes.forEach((n) => {
    const id = n.data.id;
    if (!visited.has(id)) {
      const comp = [];
      const queue = [id];
      visited.add(id);

      while (queue.length > 0) {
        const curr = queue.shift();
        comp.push(curr);
        (adj[curr] || []).forEach((nbr) => {
          if (!visited.has(nbr)) {
            visited.add(nbr);
            queue.push(nbr);
          }
        });
      }
      components.push(comp);
    }
  });

  // Sort components descending by size
  components.sort((a, b) => b.length - a.length);

  const positions = {};
  const clusters = components.filter((c) => c.length >= 5);
  const smallGroups = components.filter((c) => c.length >= 2 && c.length < 5);
  const singletons = components.filter((c) => c.length === 1);

  // 1. Layout Major Fraud Clusters in clear quadrants
  const clusterCenters = [
    { x: -520, y: -300 }, // Ring #26
    { x: 520, y: -300 },  // Ring #121
    { x: -520, y: 350 },  // Ring #211
    { x: 520, y: 350 },   // Ring #1
    { x: 0, y: -480 },    // Top cluster
    { x: 0, y: 480 },     // Bottom cluster
  ];

  clusters.forEach((comp, cIdx) => {
    const center = clusterCenters[cIdx % clusterCenters.length];
    comp.forEach((nodeId, idx) => {
      const angle = idx * 2.399963; // golden angle in radians
      const radius = 28 + Math.sqrt(idx) * 26;
      positions[nodeId] = {
        x: Math.round(center.x + radius * Math.cos(angle)),
        y: Math.round(center.y + radius * Math.sin(angle)),
      };
    });
  });

  // 2. Layout Small Connected Groups (Pairs, Triads) in an intermediate orbit
  const smallGroupCount = smallGroups.length;
  smallGroups.forEach((comp, gIdx) => {
    const groupAngle = (gIdx / Math.max(1, smallGroupCount)) * 2 * Math.PI + 0.4;
    const groupDist = 320 + (gIdx % 4) * 90;
    const gx = groupDist * Math.cos(groupAngle);
    const gy = groupDist * Math.sin(groupAngle) * 0.75;

    comp.forEach((nodeId, idx) => {
      const subAngle = (idx / comp.length) * 2 * Math.PI;
      const subRadius = 26;
      positions[nodeId] = {
        x: Math.round(gx + subRadius * Math.cos(subAngle)),
        y: Math.round(gy + subRadius * Math.sin(subAngle)),
      };
    });
  });

  // 3. Layout Organic Singletons (Natural Sunflower Starfield with organic jitter)
  const phi = (1 + Math.sqrt(5)) / 2;
  const singletonCount = singletons.length;
  singletons.forEach((comp, sIdx) => {
    const nodeId = comp[0];
    const theta = 2 * Math.PI * sIdx / (phi * phi);
    const r = 160 + Math.sqrt((sIdx + 1) / singletonCount) * 880;

    let hash = 0;
    for (let i = 0; i < nodeId.length; i++) {
      hash = (hash << 5) - hash + nodeId.charCodeAt(i);
      hash |= 0;
    }
    const jitterR = (Math.abs(hash) % 50) - 25;
    const jitterTheta = ((Math.abs(hash >> 3) % 24) - 12) * 0.01;

    positions[nodeId] = {
      x: Math.round((r + jitterR) * Math.cos(theta + jitterTheta)),
      y: Math.round(((r + jitterR) * Math.sin(theta + jitterTheta)) * 0.76),
    };
  });

  return positions;
}

export default function NetworkMapScreen({ onSelectRing }) {
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all"); // "all" | "flagged" | "review" | "clean"
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState(null);

  const cyRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    fetchGlobalGraph()
      .then((data) => {
        setGraphData(data);
        setError(null);
      })
      .catch((err) => {
        setError(err.message || "Failed to load global graph");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const elements = useMemo(() => {
    if (!graphData?.nodes) return [];

    const rawNodes = graphData.nodes.filter((n) => {
      if (activeFilter === "flagged") return n.data.status === "flagged";
      if (activeFilter === "review") return n.data.status === "needs_review";
      if (activeFilter === "clean") return n.data.status === "clean" || n.data.status === "unflagged";
      return true;
    });

    const activeNodeIds = new Set(rawNodes.map((n) => n.data.id));

    const rawEdges = (graphData.edges || [])
      .filter((e) => activeNodeIds.has(e.data.source) && activeNodeIds.has(e.data.target))
      .map((e, i) => {
        const reasons = e.data.reasons || [];
        const isRef = reasons.includes("referral");
        const isDev = reasons.includes("shared_device") || reasons.includes("device");
        const isIp = reasons.includes("shared_ip") || reasons.includes("ip");
        const edgeType = isRef ? "referral" : isDev ? "device" : isIp ? "ip" : "default";

        return {
          data: {
            id: `ge_${i}`,
            source: e.data.source,
            target: e.data.target,
            edgeType,
          },
        };
      });

    // Compute deterministic natural layout coordinates
    const positions = computeOrganicPositions(rawNodes, rawEdges);

    const nodes = rawNodes.map((n) => {
      const isFlagged = n.data.status === "flagged";
      const isReview = n.data.status === "needs_review";
      const pos = positions[n.data.id] || { x: 0, y: 0 };
      return {
        data: {
          ...n.data,
          label: n.data.id,
          nodeColor: isFlagged ? "#ef4444" : isReview ? "#f59e0b" : "#475569",
          borderColor: isFlagged ? "#fca5a5" : isReview ? "#fde68a" : "#64748b",
          size: isFlagged ? 26 : isReview ? 20 : 13,
        },
        position: pos,
      };
    });

    return [...nodes, ...rawEdges];
  }, [graphData, activeFilter]);

  const layoutConfig = useMemo(
    () => ({
      name: "preset",
      fit: true,
      padding: 50,
    }),
    []
  );

  const cyStylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          "background-color": "data(nodeColor)",
          "border-color": "data(borderColor)",
          "border-width": 2,
          width: "data(size)",
          height: "data(size)",
          label: "data(label)",
          color: "#94a3b8",
          "font-size": 8,
          "font-family": "JetBrains Mono, monospace",
          "text-valign": "bottom",
          "text-margin-y": 4,
          "text-halign": "center",
          "min-zoomed-font-size": 12,
        },
      },
      {
        selector: "node:selected",
        style: {
          "border-width": 4,
          "border-color": "#ffffff",
          "background-color": "#38bdf8",
          width: 32,
          height: 32,
          color: "#ffffff",
          "font-size": 12,
          "font-weight": "bold",
        },
      },
      {
        selector: "edge",
        style: {
          width: 1.2,
          "curve-style": "bezier",
          "line-color": "#334155",
          opacity: 0.6,
        },
      },
      {
        selector: 'edge[edgeType="referral"]',
        style: {
          "line-color": "#ef4444",
          width: 2.0,
          "line-style": "dashed",
          opacity: 0.85,
        },
      },
      {
        selector: 'edge[edgeType="device"]',
        style: {
          "line-color": "#64748b",
          width: 1.5,
          opacity: 0.7,
        },
      },
      {
        selector: 'edge[edgeType="ip"]',
        style: {
          "line-color": "#a855f7",
          width: 1.2,
          "line-style": "dotted",
          opacity: 0.7,
        },
      },
    ],
    []
  );

  // Whenever elements update, apply positions and fit viewport comfortably
  useEffect(() => {
    if (cyRef.current && elements.length > 0) {
      cyRef.current.layout(layoutConfig).run();
      setTimeout(() => {
        if (cyRef.current) {
          cyRef.current.animate({
            fit: { eles: cyRef.current.elements(), padding: 60 },
            duration: 400,
          });
        }
      }, 50);
    }
  }, [elements, layoutConfig]);

  const handleCySetup = (cy) => {
    cyRef.current = cy;
    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      setSelectedNode(node.data());
    });
    cy.on("dbltap", "node", (evt) => {
      const data = evt.target.data();
      if (data.ring_id != null) {
        onSelectRing(data.ring_id);
      }
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
      }
    });
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (!searchQuery || !cyRef.current) return;
    const target = cyRef.current.getElementById(searchQuery.trim());
    if (target && target.length > 0) {
      cyRef.current.animate({
        center: { eles: target },
        zoom: 2.5,
        duration: 600,
      });
      target.select();
      setSelectedNode(target.data());
    } else {
      alert(`Account ID "${searchQuery}" not found in current view.`);
    }
  };

  const handleResetZoom = () => {
    if (cyRef.current) {
      cyRef.current.animate({
        fit: { eles: cyRef.current.elements(), padding: 60 },
        duration: 500,
      });
      setSelectedNode(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Top Header & Search Bar */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-display-md font-display-md font-bold text-on-surface">
              Global Connection & Surveillance Map
            </h1>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-code-sm text-[11px] text-primary">
              Full Graph View
            </span>
          </div>
          <p className="mt-1 text-body-sm font-body-sm text-on-surface-variant">
            Explore un-flagged entity density, compare organic network structure vs. coordinated fraud rings across 500 monitored merchants.
          </p>
        </div>

        {/* Search & Layout Actions */}
        <div className="flex items-center gap-3">
          <form onSubmit={handleSearch} className="relative flex items-center">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Account ID (e.g. ACC-0004)..."
              className="w-64 rounded-lg border border-outline-variant/60 bg-[#181b26] py-1.5 pl-8 pr-3 font-code-sm text-body-sm text-on-surface placeholder:text-outline outline-none focus:border-primary"
            />
            <Icon name="search" className="pointer-events-none absolute left-2.5 text-base text-on-surface-variant" />
          </form>
          <button
            onClick={handleResetZoom}
            className="flex items-center gap-1.5 rounded-lg border border-outline-variant/60 bg-[#181b26] px-3 py-1.5 font-code-sm text-body-sm text-on-surface transition-colors hover:bg-surface-container-high"
          >
            <Icon name="center_focus_strong" className="text-base text-primary" /> Fit All
          </button>
        </div>
      </div>

      {/* Filter and Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/60 bg-[#12151e] p-3">
        <div className="flex items-center gap-2">
          <span className="font-code-sm text-[11px] uppercase tracking-wider text-on-surface-variant font-medium">Filter View:</span>
          {[
            { id: "all", label: "All 500 Entities" },
            { id: "flagged", label: "Critical Flags (≥0.80)", dot: "bg-error" },
            { id: "review", label: "Review Queue (0.50–0.79)", dot: "bg-amber-400" },
            { id: "clean", label: "Cleared / Organic", dot: "bg-slate-400" },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1 font-code-sm text-code-sm transition-colors ${
                activeFilter === f.id
                  ? "border border-primary/40 bg-primary/10 font-bold text-primary"
                  : "border border-outline-variant/30 text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {f.dot && <span className={`h-2 w-2 rounded-full ${f.dot}`} />}
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 font-code-sm text-[11px] text-on-surface-variant">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-error" /> Flagged Ring
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> Review Queue
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-500" /> Organic
          </div>
          <div className="h-4 w-px bg-outline-variant/50" />
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-[#64748b]" /> Shared Device
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 border-b border-dashed border-[#ef4444]" /> Referral
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="relative h-[680px] w-full overflow-hidden rounded-xl border border-outline-variant/60 bg-[#0c0e14] bg-[radial-gradient(#1e2433_1px,transparent_1px)] [background-size:24px_24px] shadow-2xl">
        {loading ? (
          <div className="flex h-full w-full items-center justify-center gap-2 text-on-surface-variant">
            <Icon name="sync" className="animate-spin text-3xl text-primary" />
            <span className="font-code-sm text-body-sm">Rendering 500-node graph topology...</span>
          </div>
        ) : error ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-error">
            <Icon name="error" className="text-3xl" />
            <p className="font-code-sm text-code-sm">{error}</p>
          </div>
        ) : (
          <>
            <CytoscapeComponent
              cy={handleCySetup}
              elements={elements}
              stylesheet={cyStylesheet}
              layout={layoutConfig}
              className="h-full w-full"
              style={{ width: "100%", height: "100%" }}
              minZoom={0.1}
              maxZoom={4.0}
            />

            {/* Top-Left Canvas Live Stats Pill */}
            <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-outline-variant/60 bg-[#12151f]/90 px-3 py-1.5 font-code-sm text-[11px] text-on-surface-variant backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span>
                Showing <strong className="text-on-surface">{elements.filter((e) => !e.data.source).length} / 500</strong> Entities (<strong className="text-on-surface">{elements.filter((e) => e.data.source).length}</strong> Relationships)
              </span>
            </div>

            {/* Bottom-Right Explanatory Footnote Badge */}
            <div className="absolute bottom-4 right-4 z-10 max-w-xs rounded-lg border border-outline-variant/50 bg-[#12151f]/85 p-2.5 font-code-sm text-[10px] text-on-surface-variant/80 backdrop-blur-md">
              <div className="flex items-center gap-1 font-bold text-on-surface">
                <Icon name="info" className="text-[13px] text-primary" /> Topology Map
              </div>
              <p className="mt-0.5 leading-tight">
                High-density fraud rings cluster distinctly around the perimeter. Natural pairs/triads share legitimate links, and independent merchants disperse organically. Double-click any ring node to inspect.
              </p>
            </div>

            {/* Selected Node / Ring Inspector Drawer */}
            {selectedNode && (
              <div className="absolute right-5 top-5 z-20 w-80 rounded-xl border border-outline-variant/70 bg-[#12151f]/95 p-4 shadow-2xl backdrop-blur-md">
                <div className="flex items-center justify-between border-b border-outline-variant/40 pb-2">
                  <span className="font-code-sm text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Selected Entity
                  </span>
                  <button onClick={() => setSelectedNode(null)} className="text-on-surface-variant hover:text-on-surface">
                    <Icon name="close" className="text-base" />
                  </button>
                </div>

                <div className="mt-3 space-y-3">
                  <div>
                    <div className="font-data-mono text-title-sm font-bold text-on-surface">{selectedNode.id}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 font-code-sm text-[10px] font-bold uppercase tracking-wider ${
                          selectedNode.status === "flagged"
                            ? "bg-error/20 text-error border border-error/30"
                            : selectedNode.status === "needs_review"
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            : "bg-slate-700/40 text-slate-300 border border-slate-600"
                        }`}
                      >
                        {selectedNode.status === "flagged"
                          ? "Critical Flag"
                          : selectedNode.status === "needs_review"
                          ? "Review Queue"
                          : "Organic / Cleared"}
                      </span>
                      {selectedNode.ring_id != null && (
                        <span className="font-code-sm text-[11px] text-primary">
                          Ring #{selectedNode.ring_id}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5 rounded-lg border border-outline-variant/40 bg-[#181c28] p-3 font-code-sm text-[12px]">
                    <div className="flex justify-between text-on-surface-variant">
                      <span>KYC Status:</span>
                      <span className="font-bold text-on-surface">{selectedNode.kyc_status || "VERIFIED"}</span>
                    </div>
                    <div className="flex justify-between text-on-surface-variant">
                      <span>Signup Date:</span>
                      <span className="text-on-surface">{selectedNode.signup_time?.slice(0, 10) || "2025-01-10"}</span>
                    </div>
                    {selectedNode.score != null && (
                      <div className="flex justify-between text-on-surface-variant">
                        <span>Cluster Risk Score:</span>
                        <span className="font-bold text-error">{formatScoreProb(selectedNode.score)}</span>
                      </div>
                    )}
                  </div>

                  {selectedNode.ring_id != null ? (
                    <button
                      onClick={() => onSelectRing(selectedNode.ring_id)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-container py-2.5 font-code-sm text-body-sm font-semibold text-on-primary-container shadow-lg transition-all hover:bg-primary-container/90 active:scale-95"
                    >
                      <Icon name="search" className="text-base" />
                      Inspect Ring #{selectedNode.ring_id} →
                    </button>
                  ) : (
                    <div className="rounded-lg border border-outline-variant/30 bg-[#181c28]/50 p-2.5 text-center font-code-sm text-[11px] text-on-surface-variant">
                      Organic entity — no coordinated ring signature detected.
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
