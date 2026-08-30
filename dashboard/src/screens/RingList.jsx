import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { fetchRings } from "../lib/api.js";
import { formatCurrency, formatScoreProb, scoreBandMeta, scoreTone, scoreTrack, signalIcon, signalLabel, statusMeta, timeAgo } from "../lib/format.js";

const PER_PAGE = 8;

const STATUS_FILTERS = [
  { key: "all", label: "All Candidates" },
  { key: "flagged", label: "Flagged (Critical)" },
  { key: "needs_review", label: "Needs Review" },
  { key: "clean", label: "Cleared / Dismissed" },
];

export default function RingList({ onSelectRing, onOpenIngest }) {
  const [rings, setRings] = useState(null);
  const [error, setError] = useState(false);
  const [activeStatus, setActiveStatus] = useState("all");
  const [scoreFilter, setScoreFilter] = useState("all");
  const [page, setPage] = useState(1);

  const load = () => {
    setRings(null);
    setError(false);
    fetchRings()
      .then((data) => {
        setRings(Array.isArray(data) ? data : data.rings || []);
      })
      .catch(() => {
        setError(true);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!rings) return [];
    return rings
      .filter((r) => {
        if (activeStatus === "all") return true;
        if (activeStatus === "flagged") return r.status === "flagged" || r.status === "confirmed_fraud";
        if (activeStatus === "needs_review") return r.status === "needs_review";
        if (activeStatus === "clean") return r.status === "clean" || r.status === "dismissed_fp";
        return true;
      })
      .filter((r) => {
        if (scoreFilter === "08") return r.ring_score >= 0.8;
        if (scoreFilter === "05") return r.ring_score >= 0.5 && r.ring_score < 0.8;
        return true;
      })
      .sort((a, b) => b.ring_score - a.ring_score);
  }, [rings, activeStatus, scoreFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const visible = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  useEffect(() => setPage(1), [activeStatus, scoreFilter]);

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="mt-2 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-display-lg font-display-lg font-bold">Investigation & Risk Queue</h2>
            <p className="mt-1 text-body-sm font-body-sm text-on-surface-variant">
              Triage coordinated fraud rings by calibrated probability, structural density, and financial exposure.
            </p>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div className="flex items-center rounded-lg border border-outline-variant bg-surface-container-low p-1">
              <span className="mr-1 px-2 font-code-sm text-code-sm uppercase tracking-wider text-outline">Status</span>
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setActiveStatus(f.key)}
                  className={`rounded-md px-3 py-1 text-body-sm font-body-sm transition-colors ${
                    activeStatus === f.key
                      ? "border border-primary/30 bg-primary/10 font-medium text-primary"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <select
                value={scoreFilter}
                onChange={(e) => setScoreFilter(e.target.value)}
                className="appearance-none rounded-lg border border-outline-variant bg-surface-container-low px-3 py-1.5 pr-8 text-body-sm font-body-sm text-on-surface-variant transition-all hover:border-primary hover:text-primary outline-none"
              >
                <option value="all">Score: All Probabilities</option>
                <option value="08">Critical (≥0.80)</option>
                <option value="05">Review Band (0.50–0.79)</option>
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant">
                <Icon name="arrow_drop_down" className="text-[16px]" />
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onOpenIngest}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-primary-container px-5 py-2.5 font-medium text-on-primary-container shadow-[0_0_15px_rgba(77,142,255,0.15)] transition-colors duration-150 hover:bg-primary-container/90 active:scale-95"
        >
          <Icon name="cloud_upload" className="text-[20px]" />
          <span className="tracking-wide">Upload Dataset</span>
        </button>
      </div>

      {/* Threshold Scale Context Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-2.5 font-code-sm text-[12px] text-on-surface-variant">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-on-surface">Decision Bands:</span>
          <span className="flex items-center gap-1 text-error">
            <span className="h-2 w-2 rounded-full bg-error" /> ≥0.80 Critical (Auto-Isolated)
          </span>
          <span className="text-outline">|</span>
          <span className="flex items-center gap-1 text-tertiary">
            <span className="h-2 w-2 rounded-full bg-tertiary" /> 0.50–0.79 Borderline (Human Review SLA 2h)
          </span>
          <span className="text-outline">|</span>
          <span className="flex items-center gap-1 text-on-surface-variant/70">
            <span className="h-2 w-2 rounded-full bg-outline" /> &lt;0.50 Cleared / Benign
          </span>
        </div>
        <span className="text-on-surface-variant/60">Model: RandomForest (Tuned on Dev seed-42)</span>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-error/30 bg-error-container/10 px-4 py-3">
          <div className="flex items-center gap-2 text-body-sm text-error">
            <Icon name="cloud_off" className="text-[16px]" />
            <span>Cannot reach the API — start the FastAPI backend, then retry.</span>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-md border border-error/30 px-3 py-1 text-body-sm font-medium text-error transition-colors hover:bg-error/10"
          >
            <Icon name="refresh" className="text-[15px]" />
            Retry
          </button>
        </div>
      )}

      {/* Table Container */}
      <div className="flex w-full flex-col overflow-hidden rounded-xl border border-outline-variant bg-[#11141D]/80 shadow-2xl backdrop-blur-md">
        {error ? (
          <div className="py-16 text-center text-on-surface-variant">
            No data — start the backend and press Retry above.
          </div>
        ) : !rings ? (
          <div className="flex items-center justify-center gap-2 py-16 text-on-surface-variant">
            <Icon name="sync" className="animate-spin" />
            Loading rings…
          </div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-on-surface-variant">No rings match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse whitespace-nowrap text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-lowest/50">
                  <th className="px-4 py-3 text-body-sm font-medium text-on-surface-variant">
                    <div className="flex cursor-pointer items-center gap-1 transition-colors hover:text-primary">
                      Ring ID <Icon name="arrow_downward" className="text-[14px]" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-body-sm font-medium text-on-surface-variant">Status</th>
                  <th className="px-4 py-3 text-body-sm font-medium text-on-surface-variant">Accounts</th>
                  <th className="px-4 py-3 text-body-sm font-medium text-on-surface-variant">Est. Exposure</th>
                  <th className="w-[160px] px-4 py-3 text-body-sm font-medium text-on-surface-variant">
                    Risk Probability
                  </th>
                  <th className="px-4 py-3 text-body-sm font-medium text-on-surface-variant">Primary Signals</th>
                  <th className="px-4 py-3 text-body-sm font-medium text-on-surface-variant">Detected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/50 text-body-md font-body-md">
                {visible.map((ring) => {
                  const meta = statusMeta(ring.status);
                  const band = scoreBandMeta(ring.ring_score);
                  const signals = ring.primary_signals;
                  const decision = ring.analyst_decision;

                  return (
                    <tr
                      key={ring.component_id}
                      onClick={() => onSelectRing(ring.component_id)}
                      className="group relative cursor-pointer transition-colors hover:bg-surface-container-high"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className={`absolute left-0 h-7 w-1 rounded-full transition-opacity ${
                              ring.ring_score >= 0.8 ? "bg-error" : ring.ring_score >= 0.5 ? "bg-tertiary" : "bg-outline-variant"
                            } opacity-0 group-hover:opacity-100`}
                          />
                          <span className={`font-data-mono font-medium tracking-wide ${
                            ring.ring_score >= 0.5 ? "text-primary" : "text-on-surface"
                          }`}>
                            #{ring.component_id}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-code-sm text-[11px] font-medium uppercase tracking-wider ${meta.cls}`}>
                            {ring.status === "clean" ? (
                              <Icon name="check" className="text-[11px]" />
                            ) : (
                              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                            )}
                            {meta.label}
                          </span>
                          {decision && (
                            <span className="rounded bg-surface-container-highest px-1.5 py-0.5 font-code-sm text-[10px] font-semibold text-on-surface border border-outline">
                              {decision.action === "CONFIRM_FRAUD" ? "✓ Confirmed" : "✗ Dismissed"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-data-mono font-semibold text-on-surface">
                          {ring.size?.toLocaleString()} accts
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-code-sm font-semibold text-tertiary">
                          {formatCurrency(ring.estimated_exposure_gmv)}
                        </span>
                      </td>
                      <td className="w-[160px] px-4 py-3">
                        <div className="flex w-full max-w-[140px] items-center gap-2">
                          <span className={`w-9 font-data-mono text-[12px] font-bold ${scoreTone(ring.ring_score)}`}>
                            {formatScoreProb(ring.ring_score)}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container">
                            <div
                              className={`h-full rounded-full ${scoreTrack(ring.ring_score)} ${ring.ring_score >= 0.8 ? "shadow-glow-error" : ""}`}
                              style={{ width: `${Math.round(ring.ring_score * 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {signals && signals.length > 0 ? (
                            signals.map((s) => (
                              <span key={s} className="flex items-center gap-1 rounded border border-outline-variant bg-surface-container px-1.5 py-0.5 font-code-sm text-[10px] text-on-surface-variant">
                                <Icon name={signalIcon(s)} className="text-[12px]" />
                                {signalLabel(s)}
                              </span>
                            ))
                          ) : (
                            <span className="flex items-center gap-1 rounded border border-outline-variant bg-surface-container px-1.5 py-0.5 font-code-sm text-[10px] text-outline">
                              <Icon name="info" className="text-[12px]" />
                              Pattern Normal
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-code-sm text-on-surface-variant text-[12px]">
                        {timeAgo(ring.detected_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-outline-variant bg-surface-container-lowest px-6 py-4">
          <span className="text-body-sm font-body-sm text-on-surface-variant">
            Showing {(page - 1) * PER_PAGE + 1} to {Math.min(page * PER_PAGE, filtered.length)} of {filtered.length} rings
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex h-8 w-8 items-center justify-center rounded border border-outline-variant text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
            >
              <Icon name="chevron_left" className="text-sm" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`flex h-8 w-8 items-center justify-center rounded border text-body-sm font-body-sm transition-colors ${
                  p === page
                    ? "border-primary bg-primary-container/10 text-primary font-bold"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-8 w-8 items-center justify-center rounded border border-outline-variant text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
            >
              <Icon name="chevron_right" className="text-sm" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
