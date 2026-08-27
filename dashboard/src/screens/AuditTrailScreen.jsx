import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { fetchAudit } from "../lib/api.js";
import { signalLabel, signalIcon, timeAgo } from "../lib/format.js";

const TYPE_FILTERS = ["All", "Detection Run", "Ring Flagged", "Needs Review"];

function typeFor(ev) {
  if (ev.type === "detection_run") return "Detection Run";
  if (ev.type === "ring_review") return "Needs Review";
  return "Ring Flagged";
}

function StatusBadge({ status }) {
  const cls =
    status === "FLAGGED"
      ? "bg-error/15 text-error border-error/20"
      : status === "REVIEW"
        ? "bg-tertiary/15 text-tertiary border-tertiary/20"
        : "bg-emerald-900/30 text-emerald-400 border-emerald-800";
  return (
    <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${cls}`}>{status}</span>
  );
}

function EventPayload({ ev, onSelectRing }) {
  if (ev.type === "detection_run") {
    return (
      <div className="border-t border-dashed border-[#1E293B] bg-[#0A0C10] px-6 pb-4 pt-3 font-code-sm text-code-sm text-on-surface-variant">
        <div>Detection run on active batch.</div>
        <div className="mt-1">
          Flagged: <span className="text-error">{ev.flagged}</span> · Needs review:{" "}
          <span className="text-tertiary">{ev.needs_review}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="border-t border-dashed border-[#1E293B] bg-[#0A0C10] px-6 pb-4 pt-3">
      <p className="text-body-sm font-body-sm text-on-surface-variant">{ev.summary}</p>
      {ev.primary_signals?.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {ev.primary_signals.map((s) => (
            <span key={s} className="flex items-center gap-1.5 rounded-md border border-outline-variant bg-surface-container px-2 py-1 font-code-sm text-code-sm text-on-surface-variant">
              <Icon name={signalIcon(s)} className="text-[14px]" />
              {signalLabel(s)}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-4 font-code-sm text-code-sm text-on-surface-variant">
        <span>Ring score: <span className="text-error">{Math.round((ev.ring_score || 0) * 100)}</span></span>
        <span>Members: <span className="text-on-surface">{ev.size}</span></span>
        {ev.ring_id != null && onSelectRing && (
          <button
            onClick={() => onSelectRing(ev.ring_id)}
            className="ml-auto flex items-center gap-1 rounded border border-primary/30 px-3 py-1 text-primary transition-colors hover:bg-primary/10"
          >
            View ring <Icon name="chevron_right" className="text-[14px]" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function AuditTrailScreen({ onSelectRing }) {
  const [events, setEvents] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [type, setType] = useState("All");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchAudit()
      .then((res) => !cancelled && setEvents(res.events || []))
      .catch((e) => !cancelled && setErr(e.message || "Failed to load audit trail"));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    if (!events) return [];
    return events.filter((ev) => {
      const mType = type === "All" || typeFor(ev) === type;
      const hay = `${ev.summary} ${ev.actor} ${ev.ring_id ?? ""} ${ev.ts ?? ""}`.toLowerCase();
      const mQuery = !query || hay.includes(query.toLowerCase());
      return mType && mQuery;
    });
  }, [events, type, query]);

  if (err) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-on-surface-variant">
        <Icon name="error" className="text-3xl text-error" />
        <p className="font-code-sm text-code-sm">{err}</p>
      </div>
    );
  }
  if (!events) {
    return (
      <div className="flex h-64 items-center justify-center text-on-surface-variant">
        <Icon name="sync" className="animate-spin text-3xl text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-display-lg font-display-lg text-on-surface">Audit Trail</h2>
          <p className="mt-2 text-body-md font-body-md text-on-surface-variant">
            Chronological log of detection activity, derived from the live run.
          </p>
        </div>
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-2 rounded border border-[#1E293B] bg-[#0A0C10] p-1 transition-all focus-within:border-primary focus-within:shadow-[0_0_8px_rgba(173,198,255,0.2)]">
            <Icon name="search" className="px-1 text-sm text-on-surface-variant" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search logs..."
              className="w-40 bg-transparent text-body-sm font-body-sm text-on-surface outline-none placeholder:text-on-surface-variant"
            />
          </div>
          <div className="flex items-center gap-2 rounded border border-[#1E293B] bg-[#0A0C10] p-1 transition-all focus-within:border-primary focus-within:shadow-[0_0_8px_rgba(173,198,255,0.2)]">
            <Icon name="filter_alt" className="px-2 text-sm text-on-surface-variant" />
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="bg-transparent py-1 pl-0 pr-8 text-body-sm font-body-sm text-on-surface focus:ring-0"
            >
              {TYPE_FILTERS.map((t) => (
                <option key={t} value={t}>{t === "All" ? "Action Type: All" : t}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-[#1E293B] bg-[#11141D]/90 backdrop-blur-[8px]">
        <div className="grid grid-cols-[1fr_2fr_1fr_1fr_auto] gap-4 border-b border-[#1E293B] bg-surface-container-low px-6 py-3 text-body-sm font-body-sm uppercase tracking-wider text-on-surface-variant">
          <div>Timestamp</div>
          <div>Event</div>
          <div>Actor</div>
          <div>Status</div>
          <div className="w-8"></div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-on-surface-variant">
              <Icon name="search" className="text-[16px]" /> No log entries match.
            </div>
          ) : (
            rows.map((ev) => {
              const open = expanded === ev.event_id;
              const title =
                ev.type === "detection_run"
                  ? "Detection run completed"
                  : `Ring ${ev.ring_id} ${ev.type === "ring_review" ? "queued for review" : "flagged"}`;
              return (
                <div key={ev.event_id} className="row-hover border-b border-[#1E293B] transition-colors">
                  <div
                    className="grid cursor-pointer grid-cols-[1fr_2fr_1fr_1fr_auto] items-center gap-4 px-6 py-4"
                    onClick={() => setExpanded(open ? null : ev.event_id)}
                  >
                    <div className="font-data-mono text-tertiary">{timeAgo(ev.ts)}</div>
                    <div className="font-data-mono text-on-surface">{title}</div>
                    <div className="font-data-mono text-primary">{ev.actor}</div>
                    <div><StatusBadge status={ev.status} /></div>
                    <Icon name={open ? "expand_less" : "expand_more"} className="text-on-surface-variant transition-colors group-hover:text-primary" />
                  </div>
                  {open && <EventPayload ev={ev} onSelectRing={onSelectRing} />}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
