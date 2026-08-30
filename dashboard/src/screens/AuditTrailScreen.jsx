import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { fetchAudit, verifyAuditChain } from "../lib/api.js";
import { formatCurrency, formatScoreProb, signalLabel, signalIcon, timeAgo } from "../lib/format.js";

const TYPE_FILTERS = ["All", "Analyst Decisions", "Flagged Rings", "Needs Review", "Detection Runs"];

function typeCategory(ev) {
  const t = ev.action_type || ev.type || "";
  if (t.includes("ANALYST")) return "Analyst Decisions";
  if (t.includes("FLAGGED")) return "Flagged Rings";
  if (t.includes("REVIEW")) return "Needs Review";
  if (t.includes("DETECTION")) return "Detection Runs";
  return "All";
}

function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();
  const cls =
    s.includes("CONFIRMED") || s === "FLAGGED"
      ? "bg-error/20 text-error border-error/30"
      : s.includes("REVIEW")
      ? "bg-tertiary/20 text-tertiary border-tertiary/30"
      : s.includes("DISMISSED")
      ? "bg-surface-container-highest text-on-surface border-outline"
      : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";

  return <span className={`rounded border px-2 py-0.5 font-code-sm text-[10px] font-bold ${cls}`}>{status}</span>;
}

function EventPayload({ ev, onSelectRing }) {
  const evidence = ev.evidence || {};
  const modelMeta = ev.model_metadata || {};

  return (
    <div className="border-t border-dashed border-outline-variant/60 bg-[#090B10] px-6 pb-5 pt-4 text-body-sm">
      <div className="flex flex-col gap-3">
        {/* Summary Narrative */}
        <p className="text-on-surface font-medium leading-relaxed">{ev.summary}</p>

        {/* Cryptographic Block Header Info */}
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-outline-variant/50 bg-surface-container-lowest/70 p-3 font-code-sm text-[11px] sm:grid-cols-2">
          <div>
            <span className="text-outline uppercase">Block Hash (SHA-256): </span>
            <span className="text-primary font-mono select-all">
              {ev.event_hash ? `${ev.event_hash.slice(0, 16)}...${ev.event_hash.slice(-8)}` : "GENESIS"}
            </span>
          </div>
          <div>
            <span className="text-outline uppercase">Parent Block: </span>
            <span className="text-on-surface-variant font-mono select-all">
              {ev.prev_hash ? `${ev.prev_hash.slice(0, 16)}...${ev.prev_hash.slice(-8)}` : "0000...0000"}
            </span>
          </div>
          <div>
            <span className="text-outline uppercase">Model Governance: </span>
            <span className="text-on-surface">
              {modelMeta.model_name || "RandomForest"} ({modelMeta.model_version || "v1.0"}) · Threshold: {modelMeta.threshold || "0.50"}
            </span>
          </div>
          <div>
            <span className="text-outline uppercase">Block Sequence: </span>
            <span className="text-emerald-400 font-bold">Block #{String(ev.block_index ?? 0).padStart(6, "0")}</span>
          </div>
        </div>

        {/* Evidence & Signals */}
        {evidence.primary_signals?.length ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="font-code-sm text-[11px] text-outline font-semibold uppercase">Contributing Signals:</span>
            {evidence.primary_signals.map((s) => (
              <span key={s} className="flex items-center gap-1 rounded bg-surface-container px-2 py-0.5 font-code-sm text-[11px] text-on-surface-variant border border-outline-variant">
                <Icon name={signalIcon(s)} className="text-[13px] text-primary" />
                {signalLabel(s)}
              </span>
            ))}
          </div>
        ) : null}

        {/* Action Row */}
        <div className="mt-2 flex items-center justify-between border-t border-outline-variant/30 pt-3">
          <div className="flex items-center gap-4 font-code-sm text-[12px] text-on-surface-variant">
            {evidence.ring_score != null && (
              <span>
                Risk Score: <strong className="text-error">{formatScoreProb(evidence.ring_score)}</strong>
              </span>
            )}
            {evidence.size != null && (
              <span>
                Members: <strong className="text-on-surface">{evidence.size}</strong>
              </span>
            )}
            {evidence.estimated_exposure_gmv != null && (
              <span>
                Exposure: <strong className="text-tertiary">{formatCurrency(evidence.estimated_exposure_gmv)}</strong>
              </span>
            )}
          </div>

          {ev.ring_id != null && onSelectRing && (
            <button
              onClick={() => onSelectRing(ev.ring_id)}
              className="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-3 py-1 font-code-sm text-[12px] font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              Investigate Ring #{ev.ring_id} <Icon name="chevron_right" className="text-[14px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AuditTrailScreen({ onSelectRing }) {
  const [events, setEvents] = useState(null);
  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [type, setType] = useState("All");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState(null);

  const loadAudit = () => {
    fetchAudit()
      .then((res) => {
        setEvents(res.events || []);
        setVerification(res.cryptographic_verification || null);
      })
      .catch((e) => setErr(e.message || "Failed to load audit trail"));
  };

  useEffect(() => {
    loadAudit();
  }, []);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await verifyAuditChain();
      setVerification(res);
    } catch (e) {
      alert(`Verification check error: ${e.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleExportJson = () => {
    if (!events) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(
      JSON.stringify({ compliance_report: "SENTRA_REGULATORY_AUDIT_LOG", export_timestamp: new Date().toISOString(), verification, events }, null, 2)
    );
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `sentra_compliance_audit_ledger_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const rows = useMemo(() => {
    if (!events) return [];
    return events.filter((ev) => {
      const cat = typeCategory(ev);
      const mType = type === "All" || cat === type;
      const hay = `${ev.summary} ${ev.actor} ${ev.action_type || ""} ${ev.ring_id ?? ""} ${ev.timestamp ?? ""}`.toLowerCase();
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
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-display-lg font-display-lg font-bold text-on-surface">Regulatory Audit Ledger</h2>
          <p className="mt-1 text-body-sm font-body-sm text-on-surface-variant">
            Tamper-evident, cryptographically chained activity ledger for regulatory reconstruction (RBI / FinCEN / SEBI).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2 font-code-sm text-body-sm font-medium text-on-surface transition-all hover:border-primary hover:text-primary"
          >
            <Icon name="download" className="text-lg" />
            Export Compliance Report
          </button>
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-code-sm text-body-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition-all hover:bg-emerald-500 active:scale-95"
          >
            {verifying ? <Icon name="sync" className="animate-spin" /> : <Icon name="verified" />}
            Verify Ledger Integrity
          </button>
        </div>
      </div>

      {/* Cryptographic Verification Status Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4.5 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
            <Icon name="lock" className="text-xl" />
          </div>
          <div>
            <div className="flex items-center gap-2 font-code-sm text-body-sm font-bold text-emerald-400">
              SHA-256 Cryptographic Chain: {verification?.integrity_status === "VERIFIED" ? "INTEGRITY VERIFIED" : "ACTIVE"}
            </div>
            <p className="font-code-sm text-[12px] text-on-surface-variant">
              {verification?.chain_length || events.length} Sealed Blocks · Algorithm: {verification?.algorithm || "SHA-256 Merkle Chain"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1 text-right font-code-sm text-[11px] text-on-surface-variant">
          <div>
            Head Block: <span className="text-primary font-mono">{verification?.head_hash ? `${verification.head_hash.slice(0, 12)}...` : "Genesis"}</span>
          </div>
          <div>Last Verified: {new Date(verification?.verified_at || Date.now()).toLocaleTimeString()}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setType(f)}
              className={`rounded-lg px-3 py-1.5 font-code-sm text-code-sm transition-colors ${
                type === f
                  ? "border border-primary/30 bg-primary/10 font-bold text-primary"
                  : "border border-outline-variant bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-1.5 focus-within:border-primary">
          <Icon name="search" className="text-on-surface-variant" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hash, actor, or ID..."
            className="w-56 bg-transparent font-code-sm text-body-sm text-on-surface outline-none placeholder:text-outline"
          />
        </div>
      </div>

      {/* Audit Event Ledger Table */}
      <div className="flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-[#11141D]/90 shadow-2xl backdrop-blur-md">
        <div className="grid grid-cols-[110px_2.5fr_1.5fr_120px_40px] gap-4 border-b border-outline-variant bg-surface-container-lowest/60 px-6 py-3 font-code-sm text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          <div>Time</div>
          <div>Event / Action</div>
          <div>Actor / Role</div>
          <div>Status</div>
          <div className="w-6" />
        </div>

        <div className="divide-y divide-outline-variant/30 overflow-y-auto max-h-[600px]">
          {rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-on-surface-variant font-code-sm">
              <Icon name="search" /> No matching audit records found.
            </div>
          ) : (
            rows.map((ev) => {
              const open = expanded === (ev.event_id || ev.block_index);
              const evId = ev.event_id || ev.block_index;
              const title = ev.summary || `${ev.action_type} - Ring #${ev.ring_id}`;

              return (
                <div key={evId} className="group transition-colors hover:bg-surface-container-high/40">
                  <div
                    className="grid cursor-pointer grid-cols-[110px_2.5fr_1.5fr_120px_40px] items-center gap-4 px-6 py-3.5"
                    onClick={() => setExpanded(open ? null : evId)}
                  >
                    <div className="font-code-sm text-[12px] text-on-surface-variant">
                      {timeAgo(ev.timestamp || ev.ts)}
                    </div>
                    <div className="font-sans text-body-sm font-medium text-on-surface truncate group-hover:text-primary">
                      {title}
                    </div>
                    <div className="font-code-sm text-[12px] text-primary truncate">
                      {ev.actor}
                    </div>
                    <div>
                      <StatusBadge status={ev.status} />
                    </div>
                    <Icon
                      name={open ? "expand_less" : "expand_more"}
                      className="text-on-surface-variant group-hover:text-primary transition-colors"
                    />
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
