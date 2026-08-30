const API_BASE = import.meta.env.VITE_API_BASE || "";

async function req(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function fetchRings() {
  return req("/api/rings");
}

export async function fetchRing(id) {
  return req(`/api/rings/${encodeURIComponent(id)}`);
}

export async function fetchSubgraph(id) {
  return req(`/api/rings/${encodeURIComponent(id)}/subgraph`);
}

export async function ingestBatch(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/ingest`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.error || `Ingest failed (${res.status})`);
  }
  return res.json();
}

export async function fetchMetrics() {
  return req("/api/evaluate");
}

export async function fetchRingsSummary() {
  return req("/api/rings/summary");
}

export async function fetchAudit() {
  return req("/api/audit");
}

export async function verifyAuditChain() {
  return req("/api/audit/verify");
}

export async function fetchAlerts() {
  return req("/api/alerts");
}

export async function acknowledgeAlert(alertId) {
  return req(`/api/alerts/${encodeURIComponent(alertId)}/ack`, { method: "POST" });
}

export async function triggerWebhookTest(endpointUrl, channel) {
  return req("/api/alerts/webhook/test", {
    method: "POST",
    body: JSON.stringify({ endpoint_url: endpointUrl, channel: channel }),
  });
}

export async function submitDecision(ringId, { action, analystId, notes, analystRole }) {
  return req(`/api/rings/${encodeURIComponent(ringId)}/decision`, {
    method: "POST",
    body: JSON.stringify({
      action,
      analyst_id: analystId || "analyst_rzp_ops_01",
      notes: notes || "",
      analyst_role: analystRole || "L2_RISK_INVESTIGATOR",
    }),
  });
}

export async function fetchDecisions() {
  return req("/api/feedback/decisions");
}
