import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { fetchRings, fetchMetrics } from "../lib/api.js";
import { timeAgo, signalLabel } from "../lib/format.js";

const TONE = {
  primary: "bg-primary/10 text-primary",
  tertiary: "bg-tertiary/10 text-tertiary",
  error: "bg-error/10 text-error",
  secondary: "bg-secondary/10 text-secondary",
};

function KpiCard({ label, value, sub, tone, icon }) {
  const t = TONE[tone] || TONE.primary;
  return (
    <div className="glass-panel flex items-center gap-4 rounded-xl p-5">
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${t.split(" ")[0]}`}>
        <Icon name={icon} className={`text-2xl ${t.split(" ")[1]}`} />
      </div>
      <div>
        <div className="text-display-md font-display-md text-on-surface">{value}</div>
        <div className="font-code-sm text-code-sm text-on-surface-variant">{label}</div>
        {sub ? <div className="font-code-sm text-code-sm text-on-surface-variant/70">{sub}</div> : null}
      </div>
    </div>
  );
}

function LiveRingRow({ ring, onOpen }) {
  const top = ring.primary_signals?.[0];
  return (
    <button
      onClick={() => onOpen(ring.component_id)}
      className="table-row-hover flex w-full items-center justify-between border-b border-outline-variant/50 px-5 py-4 text-left transition-colors"
    >
      <div className="flex items-center gap-3">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            ring.status === "flagged" ? "bg-error animate-pulse" : "bg-tertiary"
          }`}
        />
        <div>
          <div className="font-data-mono text-data-mono text-on-surface">{ring.component_id}</div>
          <div className="font-code-sm text-code-sm text-on-surface-variant">
            {ring.size} members · {top ? signalLabel(top) : "pattern"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="font-data-mono text-data-mono text-error">{Math.round((ring.ring_score || 0) * 100)}</div>
          <div className="font-code-sm text-code-sm text-on-surface-variant">score</div>
        </div>
        <div className="text-right">
          <div className="font-code-sm text-code-sm text-on-surface-variant">{timeAgo(ring.detected_at)}</div>
        </div>
        <Icon name="chevron_right" className="text-on-surface-variant" />
      </div>
    </button>
  );
}

export default function DashboardScreen({ onGoRings, onSelectRing }) {
  const [rings, setRings] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [err, setErr] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const MAX_ATTEMPTS = 5;
    const BASE_DELAY_MS = 3000;

    const tryLoad = (n) => {
      Promise.all([fetchRings(), fetchMetrics()])
        .then(([r, m]) => {
          if (cancelled) return;
          setRings(r);
          setMetrics(m);
          setErr(null);
          setRetrying(false);
        })
        .catch(() => {
          if (cancelled) return;
          if (n < MAX_ATTEMPTS) {
            const delay = BASE_DELAY_MS * Math.pow(2, n - 1); // 3s, 6s, 12s…
            setRetrying(true);
            setAttempt(n);
            timer = setTimeout(() => tryLoad(n + 1), delay);
          } else {
            setRetrying(false);
            setErr("API is not responding — make sure the backend started correctly.");
          }
        });
    };

    tryLoad(1);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const kpis = useMemo(() => {
    if (!rings || !metrics) return null;
    const al = metrics.account_level?.flagged || {};
    const flaggedAccounts = rings.reduce((s, r) => s + (r.size || 0), 0);
    return {
      ringsDetected: rings.length,
      accountsFlagged: flaggedAccounts,
      precision: al.precision,
      recall: al.recall,
      f1: al.f1,
      fpRate: metrics.false_positive_cost?.false_positive_rate,
    };
  }, [rings, metrics]);

  if (err) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-on-surface-variant">
        <Icon name="error" className="text-3xl text-error" />
        <p className="font-code-sm text-code-sm">{err}</p>
      </div>
    );
  }
  if (retrying) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-on-surface-variant">
        <Icon name="sync" className="animate-spin text-3xl text-primary" />
        <p className="font-code-sm text-code-sm">
          API starting up… retrying ({attempt}/5)
        </p>
        <p className="text-body-sm font-body-sm text-on-surface-variant/60">
          The backend runs data generation and model training on first boot — this takes ~15 s.
        </p>
      </div>
    );
  }
  if (!kpis) {
    return (
      <div className="flex h-64 items-center justify-center text-on-surface-variant">
        <Icon name="sync" className="animate-spin text-3xl text-primary" />
      </div>
    );
  }

  const pct = (v) => (v != null ? `${Math.round(v * 100)}%` : "—");

  return (
    <div className="flex flex-col gap-gutter">
      <div>
        <h1 className="text-headline-md font-headline-md font-bold text-on-surface">Detection Overview</h1>
        <p className="mt-1 text-body-sm font-body-sm text-on-surface-variant">
          Live ring detection across the active batch. Model metrics are reported on the held-out test split.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-gutter lg:grid-cols-4">
        <KpiCard label="Rings Detected" value={kpis.ringsDetected} sub="this batch" tone="primary" icon="group" />
        <KpiCard label="Accounts Flagged" value={kpis.accountsFlagged} sub="this batch" tone="tertiary" icon="person" />
        <KpiCard label="Precision" value={pct(kpis.precision)} sub="held-out test" tone="error" icon="gpp_good" />
        <KpiCard label="Recall" value={pct(kpis.recall)} sub="held-out test" tone="secondary" icon="radar" />
      </div>

      <div className="grid grid-cols-12 gap-gutter">
        <div className="glass-panel col-span-12 flex flex-col overflow-hidden rounded-xl lg:col-span-7">
          <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low/50 px-5 py-4">
            <h3 className="text-title-sm font-title-sm text-on-surface">Latest Detected Rings</h3>
            <button
              onClick={onGoRings}
              className="flex items-center gap-1 font-code-sm text-code-sm text-primary transition-colors hover:text-primary-fixed"
            >
              View all <Icon name="chevron_right" className="text-[16px]" />
            </button>
          </div>
          <div className="flex flex-col">
            {rings.slice(0, 6).map((r) => (
              <LiveRingRow key={r.component_id} ring={r} onOpen={(id) => onSelectRing?.(id)} />
            ))}
          </div>
        </div>

        <div className="glass-panel col-span-12 flex flex-col rounded-xl p-6 lg:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <Icon name="analytics" className="text-primary" />
            <h3 className="text-title-sm font-title-sm text-on-surface">Model Honesty</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest/40 p-4 text-center">
              <div className="text-title-sm font-title-sm text-error">{pct(kpis.f1)}</div>
              <div className="font-code-sm text-code-sm text-on-surface-variant">F1 (test)</div>
            </div>
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest/40 p-4 text-center">
              <div className="text-title-sm font-title-sm text-tertiary">{pct(kpis.fpRate)}</div>
              <div className="font-code-sm text-code-sm text-on-surface-variant">FP rate (test)</div>
            </div>
          </div>
          <p className="mt-4 text-body-sm font-body-sm leading-relaxed text-on-surface-variant">
            {metrics.honest_note || "Metrics reported on the held-out test split; thresholds tuned on dev only."}
          </p>
        </div>
      </div>
    </div>
  );
}
