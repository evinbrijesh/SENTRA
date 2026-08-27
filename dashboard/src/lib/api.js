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

export async function fetchAudit() {
  return req("/api/audit");
}
