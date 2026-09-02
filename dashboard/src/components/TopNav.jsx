import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { fetchHealth, fetchRings, fetchDecisions } from "../lib/api.js";

/**
 * TopNav — global command bar.
 *
 * Every control is functional:
 * - Search        -> live ring / member-account search, navigates to ring detail
 * - System pill   -> overall status (prop)
 * - dns icon      -> live backend health popover (GET /api/health)
 * - help icon     -> score-band legend + screen guide
 * - Alert Center  -> single entry point to the NotificationDrawer (with unread badge)
 * - Avatar        -> analyst identity card (HITL) with decisions count + audit link
 */

const SCORE_BANDS = [
  { range: "≥ 0.80", label: "Auto-Flagged", desc: "Critical ring — isolated automatically", color: "text-error" },
  { range: "0.50 – 0.79", label: "Urgent Review", desc: "Borderline — routed to human triage", color: "text-tertiary" },
  { range: "< 0.50", label: "Clear", desc: "Benign traffic — no action needed", color: "text-primary" },
];

const SCREEN_GUIDE = [
  { icon: "space_dashboard", label: "Command Center", desc: "Exposure KPIs and triage queues" },
  { icon: "hub", label: "Ring Queue", desc: "All detected components with scores" },
  { icon: "public", label: "Network Map", desc: "Global entity surveillance graph" },
  { icon: "verified_user", label: "Audit Ledger", desc: "SHA-256 Merkle chain + verification" },
  { icon: "monitoring", label: "Benchmarks", desc: "Dual held-out confusion matrices" },
  { icon: "upload", label: "Ingestion", desc: "Batch zip upload + re-detection" },
];

function StatusDot({ ok }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${ok ? "bg-primary" : "bg-error"}`}
      style={ok ? { boxShadow: "0 0 8px rgba(173,198,255,0.6)" } : undefined}
    />
  );
}

function PopoverShell({ children, className = "" }) {
  return (
    <div
      className={`absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border border-outline-variant bg-surface-container-low shadow-2xl shadow-black/40 ${className}`}
    >
      {children}
    </div>
  );
}

// ── Health popover (dns icon) ───────────────────────────────────────────────
function HealthPopover() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchHealth()
      .then(setHealth)
      .catch((e) => setError(e.message || "Health check failed"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const services = [
    { name: "API Gateway", ok: !!health, detail: health ? health.service : "unreachable" },
    { name: "PostgreSQL", ok: !!health?.postgres, detail: "transactional truth" },
    { name: "Neo4j", ok: !!health?.neo4j, detail: "relationship layer" },
  ];

  return (
    <PopoverShell>
      <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
        <span className="text-body-sm font-medium text-on-surface">Backend Health</span>
        <button
          onClick={load}
          title="Refresh"
          className="rounded p-1 text-on-surface-variant transition-colors hover:text-primary"
        >
          <Icon name="refresh" className="text-base" />
        </button>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        {loading && <span className="text-body-sm text-on-surface-variant">Checking services…</span>}
        {!loading && error && (
          <span className="flex items-center gap-2 text-body-sm text-error">
            <Icon name="warning" className="text-base" /> {error}
          </span>
        )}
        {!loading &&
          !error &&
          services.map((s) => (
            <div key={s.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot ok={s.ok} />
                <span className="text-body-sm text-on-surface">{s.name}</span>
              </div>
              <span className="font-code-sm text-xs uppercase tracking-wider text-on-surface-variant">
                {s.ok ? "Operational" : "Offline"}
              </span>
            </div>
          ))}
        {health && (
          <div className="border-t border-outline-variant pt-2 text-xs text-on-surface-variant">
            Graceful degradation: detection stays CSV-backed if a database is offline.
          </div>
        )}
      </div>
    </PopoverShell>
  );
}

// ── Help popover (help icon) ────────────────────────────────────────────────
function HelpPopover() {
  return (
    <PopoverShell className="w-96">
      <div className="border-b border-outline-variant px-4 py-3">
        <span className="text-body-sm font-medium text-on-surface">Risk Score Bands</span>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        {SCORE_BANDS.map((b) => (
          <div key={b.label} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className={`font-code-sm text-sm font-semibold ${b.color}`}>{b.range}</span>
              <span className="text-body-sm text-on-surface">{b.label}</span>
            </div>
            <span className="text-right text-xs text-on-surface-variant">{b.desc}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-outline-variant px-4 py-3">
        <span className="text-body-sm font-medium text-on-surface">Why a ring was flagged</span>
        <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
          Every ring carries SHAP feature attributions and plain-language reasons — shared
          device/IP fingerprints, signup burst windows, and referral loopbacks. Open any ring
          for the full evidence trail.
        </p>
      </div>
      <div className="border-t border-outline-variant px-4 py-3">
        <span className="text-body-sm font-medium text-on-surface">Screens</span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {SCREEN_GUIDE.map((s) => (
            <div key={s.label} className="flex items-start gap-2">
              <Icon name={s.icon} className="mt-0.5 text-sm text-primary" />
              <div>
                <div className="text-xs font-medium text-on-surface">{s.label}</div>
                <div className="text-[11px] leading-snug text-on-surface-variant">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-outline-variant px-4 py-2 text-[11px] text-on-surface-variant">
        Full specifications live in the repo: <span className="font-code-sm">README.md</span> and{" "}
        <span className="font-code-sm">docs/</span>.
      </div>
    </PopoverShell>
  );
}

// ── Analyst identity popover (avatar) ───────────────────────────────────────
function AnalystPopover({ onNavigateAudit }) {
  const [decisionCount, setDecisionCount] = useState(null);

  useEffect(() => {
    fetchDecisions()
      .then((d) => setDecisionCount(Object.keys(d.decisions || {}).length))
      .catch(() => setDecisionCount(null));
  }, []);

  return (
    <PopoverShell>
      <div className="flex items-center gap-3 border-b border-outline-variant px-4 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
          <Icon name="person" className="text-lg text-primary" />
        </div>
        <div>
          <div className="text-body-sm font-medium text-on-surface">analyst_rzp_ops_01</div>
          <div className="text-xs text-on-surface-variant">L2 Risk Investigator</div>
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-body-sm text-on-surface-variant">Decisions sealed in ledger</span>
          <span className="font-code-sm text-sm font-semibold text-primary">
            {decisionCount === null ? "—" : decisionCount}
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant">
          Every confirm / dismiss action you take is cryptographically sealed into the SHA-256
          audit ledger. Sentra runs in demo mode — this is a session identity, not authenticated
          access (per PRD non-goals).
        </p>
      </div>
      <div className="border-t border-outline-variant px-4 py-3">
        <button
          onClick={() => {
            onNavigateAudit();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-body-sm text-on-surface transition-all hover:border-primary hover:text-primary"
        >
          <Icon name="verified_user" className="text-base" />
          View Audit Trail
        </button>
      </div>
    </PopoverShell>
  );
}

// ── Search ──────────────────────────────────────────────────────────────────
function SearchBar({ onSelectRing }) {
  const [query, setQuery] = useState("");
  const [rings, setRings] = useState(null); // cached on first focus
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const loadRings = () => {
    if (rings === null) {
      fetchRings()
        .then(setRings)
        .catch(() => setRings([]));
    }
  };

  const q = query.trim().toLowerCase();
  const results =
    rings && q
      ? rings
          .filter(
            (r) =>
              String(r.component_id).toLowerCase().includes(q) ||
              (r.members || []).some((m) => String(m).toLowerCase().includes(q))
          )
          .slice(0, 6)
      : [];

  const select = (ring) => {
    onSelectRing?.(String(ring.component_id));
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="group relative flex w-full items-center">
      <Icon
        name="search"
        className="absolute left-3 text-lg text-on-surface-variant transition-colors group-focus-within:text-primary"
      />
      <input
        className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pl-10 pr-4 text-body-sm font-body-sm text-on-surface outline-none transition-colors placeholder:text-outline focus:border-primary focus:ring-0"
        placeholder="Search ring ID or account ID…"
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          loadRings(); // also load here: programmatic fill / autofill may not fire focus
        }}
        onFocus={() => {
          setOpen(true);
          loadRings();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results.length > 0) select(results[0]);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && q && (
        <div className="absolute left-0 top-full z-40 mt-2 w-full overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low shadow-2xl shadow-black/40">
          {rings === null && (
            <div className="px-4 py-3 text-body-sm text-on-surface-variant">Loading rings…</div>
          )}
          {rings !== null && results.length === 0 && (
            <div className="px-4 py-3 text-body-sm text-on-surface-variant">
              No rings or accounts match “{query}”
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.component_id}
              onClick={() => select(r)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-surface-container-high"
            >
              <div className="flex items-center gap-3">
                <Icon name="hub" className="text-base text-primary" />
                <div>
                  <div className="text-body-sm text-on-surface">Ring #{r.component_id}</div>
                  <div className="text-[11px] text-on-surface-variant">
                    {r.size} accounts · {r.status}
                  </div>
                </div>
              </div>
              <span className="font-code-sm text-sm text-primary">{r.ring_score?.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── TopNav ──────────────────────────────────────────────────────────────────
export default function TopNav({
  systemOk = true,
  onOpenAlerts,
  unreadAlertsCount = 0,
  onSelectRing,
  onNavigateAudit,
}) {
  const [openPopover, setOpenPopover] = useState(null); // 'health' | 'help' | 'analyst' | null
  const navRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) setOpenPopover(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpenPopover(null);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const toggle = (key) => setOpenPopover((prev) => (prev === key ? null : key));

  const iconBtn =
    "relative rounded-lg p-2 text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-primary";

  return (
    <header
      ref={navRef}
      className="fixed right-0 top-0 z-30 flex h-16 w-[calc(100%-260px)] items-center justify-between border-b border-outline-variant bg-surface/80 px-container-padding backdrop-blur-md"
    >
      <div className="flex max-w-md flex-1 items-center">
        <SearchBar onSelectRing={onSelectRing} />
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 rounded-full border border-surface-container-highest bg-surface-container-low px-3 py-1.5">
          <StatusDot ok={systemOk} />
          <span className="font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
            System: {systemOk ? "Operational" : "Offline"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => toggle("health")} title="Backend health" className={iconBtn}>
              <Icon name="dns" />
            </button>
            {openPopover === "health" && <HealthPopover />}
          </div>

          <div className="relative">
            <button onClick={() => toggle("help")} title="Help & score bands" className={iconBtn}>
              <Icon name="help" />
            </button>
            {openPopover === "help" && <HelpPopover />}
          </div>
        </div>

        <div className="h-6 w-px bg-outline-variant" />

        <div className="flex items-center gap-4">
          {/* Single entry point to the NotificationDrawer (bell merged into this button) */}
          <button
            onClick={onOpenAlerts}
            className="relative flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2 text-body-sm font-body-sm font-medium text-on-surface transition-all hover:border-primary hover:text-primary"
          >
            <Icon name="travel_explore" className="text-lg" />
            Incident Alert Center
            {unreadAlertsCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white shadow-sm animate-pulse">
                {unreadAlertsCount}
              </span>
            )}
          </button>

          <div className="relative">
            <button
              onClick={() => toggle("analyst")}
              title="Analyst session"
              className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-outline-variant bg-surface-container-highest transition-all hover:ring-2 hover:ring-primary hover:ring-offset-2 hover:ring-offset-surface"
            >
              <Icon name="person" className="text-base text-on-surface-variant" />
            </button>
            {openPopover === "analyst" && <AnalystPopover onNavigateAudit={onNavigateAudit} />}
          </div>
        </div>
      </div>
    </header>
  );
}
