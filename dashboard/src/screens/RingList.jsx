import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { fetchRings } from "../lib/api.js";
import { mockRings } from "../lib/mock.js";
import { scoreTone, scoreTrack, signalIcon, signalLabel, statusMeta, timeAgo } from "../lib/format.js";

const PER_PAGE = 8;

const STATUS_FILTERS = [
  { key: "flagged", label: "Flagged", active: true },
  { key: "needs_review", label: "Needs Review", active: false },
  { key: "clean", label: "Cleared", active: false },
];

export default function RingList({ onSelectRing, onOpenIngest }) {
  const [rings, setRings] = useState(null);
  const [usingMock, setUsingMock] = useState(false);
  const [activeStatus, setActiveStatus] = useState("flagged");
  const [scoreFilter, setScoreFilter] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetchRings()
      .then((data) => {
        if (cancelled) return;
        setRings(Array.isArray(data) ? data : data.rings || []);
        setUsingMock(false);
      })
      .catch(() => {
        if (cancelled) return;
        setRings(mockRings);
        setUsingMock(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rings) return [];
    return rings
      .filter((r) => r.status === activeStatus)
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
      <div className="mt-2 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-4">
          <h2 className="text-display-lg font-display-lg">Investigation Queue</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-outline-variant bg-surface-container-low p-1">
              <span className="mr-1 px-2 font-code-sm text-code-sm uppercase tracking-wider text-outline">Status</span>
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setActiveStatus(f.key)}
                  className={`rounded-md px-3 py-1 text-body-sm font-body-sm transition-colors ${
                    activeStatus === f.key
                      ? "border border-error/30 bg-error-container/20 font-medium text-error"
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
                className="appearance-none rounded-lg border border-outline-variant bg-surface-container-low px-3 py-1.5 pr-8 text-body-sm font-body-sm text-on-surface-variant transition-all hover:border-primary hover:text-primary"
              >
                <option value="all">Score: All</option>
                <option value="08">Score: 0.8+</option>
                <option value="05">Score: 0.5–0.8</option>
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant">
                <Icon name="arrow_drop_down" className="text-[16px]" />
              </span>
            </div>
            <button className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-1.5 text-body-sm font-body-sm text-on-surface-variant transition-all hover:border-primary hover:text-primary">
              <span className="font-code-sm text-code-sm uppercase tracking-wider text-outline">Date</span>
              <span className="font-medium text-on-surface">Last 24h</span>
              <Icon name="arrow_drop_down" className="text-[16px]" />
            </button>
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

      {usingMock && (
        <div className="flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/10 px-4 py-2 text-body-sm text-amber">
          <Icon name="info" className="text-[16px]" />
          <span>API offline — showing bundled demo data. Start the FastAPI backend for live rings.</span>
        </div>
      )}

      <div className="flex w-full flex-col overflow-hidden rounded-xl border border-outline-variant bg-[#11141D]/80 shadow-2xl backdrop-blur-md">
        {!rings ? (
          <div className="flex items-center justify-center gap-2 py-16 text-on-surface-variant">
            <Icon name="sync" className="animate-spin" />
            Loading rings…
          </div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-on-surface-variant">No rings match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse whitespace-nowrap text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-lowest/50">
                  <th className="px-5 py-4 pr-6 pl-6 text-title-sm font-title-sm font-medium text-on-surface-variant">
                    <div className="flex cursor-pointer items-center gap-1 transition-colors hover:text-primary">
                      Ring ID <Icon name="arrow_downward" className="text-[14px]" />
                    </div>
                  </th>
                  <th className="px-5 py-4 text-title-sm font-title-sm font-medium text-on-surface-variant">Status</th>
                  <th className="px-5 py-4 text-title-sm font-title-sm font-medium text-on-surface-variant">
                    <div className="flex items-center gap-1">Size</div>
                  </th>
                  <th className="w-[200px] px-5 py-4 text-title-sm font-title-sm font-medium text-on-surface-variant">
                    <div className="flex items-center gap-1">Risk Score</div>
                  </th>
                  <th className="px-5 py-4 text-title-sm font-title-sm font-medium text-on-surface-variant">Primary Signal</th>
                  <th className="px-5 py-4 pr-6 pl-6 text-title-sm font-title-sm font-medium text-on-surface-variant">Detected At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/50 text-body-md font-body-md">
                {visible.map((ring) => {
                  const meta = statusMeta(ring.status);
                  const signals = ring.primary_signals;
                  return (
                    <tr
                      key={ring.component_id}
                      onClick={() => onSelectRing(ring.component_id)}
                      className="group relative cursor-pointer transition-colors hover:bg-surface-container-high"
                    >
                      <td className="px-5 py-4 pr-6 pl-6">
                        <div className="flex items-center gap-3">
                          <span className={`absolute left-0 h-8 w-1 rounded-full transition-opacity ${
                            ring.ring_score >= 0.8 ? "bg-error" : ring.ring_score >= 0.5 ? "bg-tertiary" : "bg-outline-variant"
                          } opacity-0 group-hover:opacity-100`} />
                          <span className={`font-data-mono font-medium tracking-wide ${
                            ring.ring_score >= 0.5 ? "text-primary" : "text-on-surface"
                          }`}>
                            {ring.component_id}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-code-sm text-code-sm font-medium uppercase tracking-wider ${meta.cls}`}>
                          {ring.status === "clean" ? (
                            <Icon name="check" className="text-[12px]" />
                          ) : (
                            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          )}
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-data-mono font-semibold text-on-surface">
                          {ring.size?.toLocaleString()}
                        </span>
                      </td>
                      <td className="w-[200px] px-5 py-4">
                        <div className="flex w-full max-w-[160px] items-center gap-3">
                          <span className={`w-8 font-data-mono font-medium ${scoreTone(ring.ring_score)}`}>
                            {ring.ring_score.toFixed(2)}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container">
                            <div
                              className={`h-full rounded-full ${scoreTrack(ring.ring_score)} ${ring.ring_score >= 0.8 ? "shadow-glow-error" : ""}`}
                              style={{ width: `${Math.round(ring.ring_score * 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          {signals && signals.length > 0 ? (
                            signals.map((s) => (
                              <span key={s} className="flex items-center gap-1.5 rounded-md border border-outline-variant bg-surface-container px-2 py-1 font-code-sm text-code-sm text-on-surface-variant">
                                <Icon name={signalIcon(s)} className="text-[14px]" />
                                {signalLabel(s)}
                              </span>
                            ))
                          ) : (
                            <span className="flex items-center gap-1.5 rounded-md border border-outline-variant bg-surface-container px-2 py-1 font-code-sm text-code-sm text-outline">
                              <Icon name="info" className="text-[14px]" />
                              Pattern Normal
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 pr-6 pl-6 font-data-mono text-on-surface-variant">
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
                    ? "border-primary bg-primary-container/10 text-primary"
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
