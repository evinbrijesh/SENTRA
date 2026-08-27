export const mockRings = [
  {
    component_id: "RNG-8492-X",
    ring_score: 0.96,
    size: 1245,
    status: "flagged",
    primary_signals: ["shared_device", "ip_switch"],
    detected_at: "2026-08-27T09:40:00Z",
    temporal: { burst_minutes: 18, burst_start: "2026-08-27T09:22:00Z", burst_end: "2026-08-27T09:40:00Z" },
    structural: { unique_devices: 14, unique_ips: 6, referral_edges: 1180, shared_device_edges: 1200, shared_ip_edges: 1188 },
    has_referral_cycle: true,
    sub_scores: { shared_device: 0.98, shared_ip: 0.97, signup_burst: 0.95, referral_cycle: 1.0, referral_density: 0.92 },
  },
  {
    component_id: "RNG-7731-M",
    ring_score: 0.82,
    size: 892,
    status: "needs_review",
    primary_signals: ["velocity_anomaly"],
    detected_at: "2026-08-27T09:05:00Z",
    temporal: { burst_minutes: 220, burst_start: "2026-08-26T04:25:00Z", burst_end: "2026-08-27T09:05:00Z" },
    structural: { unique_devices: 430, unique_ips: 210, referral_edges: 40, shared_device_edges: 62, shared_ip_edges: 95 },
    has_referral_cycle: false,
    sub_scores: { shared_device: 0.5, shared_ip: 0.58, signup_burst: 0.88, referral_cycle: 0.0, referral_density: 0.34 },
  },
  {
    component_id: "RNG-9012-Y",
    ring_score: 0.99,
    size: 2105,
    status: "flagged",
    primary_signals: ["synthetic_identity", "geolocation_mismatch"],
    detected_at: "2026-08-27T08:30:00Z",
    temporal: { burst_minutes: 9, burst_start: "2026-08-27T08:21:00Z", burst_end: "2026-08-27T08:30:00Z" },
    structural: { unique_devices: 8, unique_ips: 5, referral_edges: 2040, shared_device_edges: 2075, shared_ip_edges: 2090 },
    has_referral_cycle: true,
    sub_scores: { shared_device: 1.0, shared_ip: 1.0, signup_burst: 0.99, referral_cycle: 1.0, referral_density: 0.97 },
  },
  {
    component_id: "RNG-1102-C",
    ring_score: 0.12,
    size: 45,
    status: "clean",
    primary_signals: ["pattern_normal"],
    detected_at: "2026-08-27T06:10:00Z",
    temporal: { burst_minutes: 0, burst_start: "", burst_end: "" },
    structural: { unique_devices: 44, unique_ips: 45, referral_edges: 0, shared_device_edges: 2, shared_ip_edges: 1 },
    has_referral_cycle: false,
    sub_scores: { shared_device: 0.05, shared_ip: 0.03, signup_burst: 0.0, referral_cycle: 0.0, referral_density: 0.0 },
  },
];

function edge(s, t, reasons) {
  return {
    data: { source: `${s}`, target: `${t}`, label: reasons.join(" + "), reasons },
  };
}

export function mockSubgraph(ring) {
  const count = Math.min(ring.size, 30);
  const accounts = Array.from({ length: count }, (_, i) => ({
    data: { id: `ACC-${1000 + i + Math.floor(ring.ring_score * 7)}`, kyc_status: i % 5 === 0 ? "verified" : "pending" },
  }));
  const idOf = (i) => accounts[i].data.id;
  const edges = [];
  for (let i = 0; i < count; i++) {
    if (i + 1 < count) edges.push(edge(idOf(i), idOf(i + 1), ["shared_device"]));
    if (i % 3 === 0 && i + 2 < count) edges.push(edge(idOf(i), idOf(i + 2), ["shared_ip"]));
  }
  if (ring.has_referral_cycle) {
    for (let i = 0; i < Math.min(4, count); i += 1) edges.push(edge(idOf(i), idOf((i + 1) % 4), ["referral"]));
  }
  return {
    ring_id: ring.component_id,
    nodes: accounts,
    edges,
  };
}

export function mockExplanation(ring) {
  const size = ring.size;
  const reasons = [];
  const devRatio = ring.structural.unique_devices / size;
  const ipRatio = ring.structural.unique_ips / size;
  if (ring.structural.unique_devices && devRatio < 0.5) {
    reasons.push({
      type: "Shared Device",
      detail: `${size} accounts share just ${ring.structural.unique_devices} device(s) — ${(devRatio * 100).toFixed(0)}% device concentration`,
      severity: devRatio < 0.2 ? "high" : "medium",
    });
  }
  if (ring.structural.unique_ips && ipRatio < 0.5) {
    reasons.push({
      type: "Shared IP",
      detail: `${size} accounts connect from just ${ring.structural.unique_ips} IP address(es) — ${(ipRatio * 100).toFixed(0)}% IP concentration`,
      severity: ipRatio < 0.2 ? "high" : "medium",
    });
  }
  if (ring.temporal.burst_minutes > 0) {
    reasons.push({
      type: "Signup Burst",
      detail: `Cluster signed up within ${ring.temporal.burst_minutes} minutes`,
      severity: ring.temporal.burst_minutes < 60 ? "high" : "medium",
    });
  }
  if (ring.has_referral_cycle) {
    reasons.push({
      type: "Referral Cycle",
      detail: "Closed-loop referral chain detected within the cluster — organic referral trees don't cycle back",
      severity: "high",
    });
  }
  const confidence = ring.ring_score >= 0.7 ? "high" : ring.ring_score >= 0.5 ? "medium" : "low";
  return {
    ring_id: ring.component_id,
    ring_score: ring.ring_score,
    confidence,
    summary: `Cluster of ${size} accounts flagged with ${confidence} confidence (score: ${ring.ring_score.toFixed(2)}). Primary indicators: ${reasons.slice(0, 3).map((r) => r.detail.split(" — ")[0]).join("; ")}.`,
    reasons,
    risk_factors: Object.entries(ring.sub_scores)
      .map(([factor, score]) => ({ factor, score, contribution: Math.round(score * ring.ring_score * 100) / 100 }))
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 5),
    member_summary: {
      size,
      signup_window: ring.temporal.burst_start
        ? `${ring.temporal.burst_start} to ${ring.temporal.burst_end}`
        : "N/A",
      burst_minutes: ring.temporal.burst_minutes,
    },
  };
}
