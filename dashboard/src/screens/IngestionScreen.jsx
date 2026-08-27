import { useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { ingestBatch } from "../lib/api.js";
import { signalLabel, signalIcon } from "../lib/format.js";

function countRows(rows) {
  if (!rows || typeof rows !== "object") return "—";
  return Object.entries(rows)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

export default function IngestionScreen({ onRunDetection }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | uploading | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setPhase("uploading");
    setResult(null);
    setError(null);
    try {
      const res = await ingestBatch(file);
      setResult(res);
      setPhase("done");
    } catch (e) {
      setError(e.message || "Ingest failed");
      setPhase("error");
    }
  };

  const reset = () => {
    setFileName(null);
    setPhase("idle");
    setResult(null);
    setError(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-gutter">
      <div className="mb-8">
        <h2 className="text-display-lg font-display-lg text-on-surface">Upload Dataset</h2>
        <p className="mt-2 text-body-md font-body-md text-on-surface-variant">
          Upload a <span className="font-code-sm text-code-sm text-on-surface">.zip</span> of CSVs
          (accounts, devices, ips, referrals, transactions, payment_methods). It loads into the
          stores and re-runs detection on the new batch.
        </p>
      </div>

      {phase === "idle" && (
        <div
          onClick={() => inputRef.current && inputRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
          className={`glass-panel dropzone-dashed group flex cursor-pointer flex-col items-center justify-center rounded-xl p-12 text-center transition-all ${dragOver ? "border-primary bg-primary/5" : ""}`}
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high transition-colors group-hover:border-primary/30 group-hover:bg-primary/10">
            <Icon name="cloud_upload" className="text-3xl text-on-surface-variant transition-colors group-hover:text-primary" />
          </div>
          <h3 className="mb-2 text-title-sm font-title-sm text-on-surface">Drag &amp; Drop ZIP</h3>
          <p className="mb-6 text-body-sm font-body-sm text-on-surface-variant">or click to browse from your computer (Max 500MB)</p>
          <button className="rounded border border-outline-variant bg-surface-container-high px-6 py-2 text-body-sm font-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest">
            Select File
          </button>
        </div>
      )}
      <input ref={inputRef} type="file" accept=".zip" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />

      {phase === "uploading" && (
        <div className="glass-panel rounded-xl p-6">
          <div className="flex items-center gap-3">
            <Icon name="sync" className="animate-spin text-primary" />
            <span className="text-title-sm font-title-sm text-on-surface">Ingesting {fileName}…</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
          </div>
          <p className="mt-3 font-code-sm text-code-sm text-on-surface-variant">Loading into Postgres/Neo4j and re-running detection…</p>
        </div>
      )}

      {phase === "error" && (
        <div className="glass-panel rounded-xl border border-error/30 p-6">
          <div className="flex items-center gap-3">
            <Icon name="error" className="text-error" />
            <span className="text-title-sm font-title-sm text-error">Ingest failed</span>
          </div>
          <p className="mt-2 font-code-sm text-code-sm text-on-surface-variant">{error}</p>
          <button onClick={reset} className="mt-4 rounded border border-outline-variant px-4 py-2 text-body-sm text-on-surface transition-colors hover:bg-surface-container-highest">
            Try again
          </button>
        </div>
      )}

      {phase === "done" && result && (
        <>
          <div className="grid grid-cols-12 gap-gutter">
            <div className="glass-panel col-span-12 flex flex-col justify-center rounded-xl p-6 md:col-span-4">
              <div className="mb-4 flex items-center gap-2">
                <Icon name="check_circle" filled className="text-sm text-emerald-400" />
                <span className="font-body-sm text-body-sm font-semibold uppercase tracking-wider text-on-surface-variant">Ingest Successful</span>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-display-lg font-display-lg text-on-surface">{result.ring_count}</div>
                  <div className="font-code-sm text-code-sm text-on-surface-variant">Rings Detected</div>
                </div>
                <div className="h-px w-full bg-outline-variant/50" />
                <div>
                  <div className="text-title-sm font-title-sm text-primary">{result.batch_id}</div>
                  <div className="font-code-sm text-code-sm text-on-surface-variant">Batch ID</div>
                </div>
              </div>
            </div>
            <div className="glass-panel col-span-12 flex flex-col overflow-hidden rounded-xl md:col-span-8">
              <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low/50 px-4 py-3">
                <h3 className="flex items-center gap-2 text-body-md font-body-md font-semibold text-on-surface">
                  <Icon name="table_chart" className="text-sm" /> Loaded Rows
                </h3>
                <span className="rounded border border-outline-variant bg-surface-container-lowest px-2 py-0.5 font-code-sm text-code-sm text-on-surface-variant">{fileName}</span>
              </div>
              <div className="overflow-x-auto p-4">
                <div className="font-code-sm text-code-sm text-on-surface-variant">{countRows(result.rows_loaded)}</div>
              </div>
            </div>
          </div>

          {result.rings?.length ? (
            <div className="glass-panel mt-8 flex flex-col overflow-hidden rounded-xl">
              <div className="border-b border-outline-variant bg-surface-container-low/50 px-5 py-4">
                <h3 className="text-title-sm font-title-sm text-on-surface">Detected Rings</h3>
              </div>
              <div className="flex flex-col">
                {result.rings.map((r) => (
                  <div key={r.component_id} className="flex items-center justify-between border-b border-outline-variant/50 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${r.status === "flagged" ? "bg-error" : "bg-tertiary"}`} />
                      <span className="font-data-mono text-data-mono text-on-surface">{r.component_id}</span>
                      <span className="font-code-sm text-code-sm text-on-surface-variant">{r.size} members</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {r.primary_signals?.slice(0, 2).map((s) => (
                        <span key={s} className="flex items-center gap-1.5 rounded-md border border-outline-variant bg-surface-container px-2 py-1 font-code-sm text-code-sm text-on-surface-variant">
                          <Icon name={signalIcon(s)} className="text-[14px]" />
                          {signalLabel(s)}
                        </span>
                      ))}
                      <span className="font-data-mono text-data-mono text-error">{Math.round((r.ring_score || 0) * 100)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-8 font-code-sm text-code-sm text-on-surface-variant">No rings detected in this batch.</p>
          )}

          <div className="mt-8 flex justify-end gap-3 border-t border-outline-variant pt-6">
            <button onClick={reset} className="rounded-lg border border-outline-variant px-6 py-3 text-title-sm font-title-sm text-on-surface transition-colors hover:bg-surface-container-highest">
              Upload another
            </button>
            <button
              onClick={onRunDetection}
              className="flex items-center gap-2 rounded-lg bg-[#3B82F6] px-8 py-3 text-title-sm font-title-sm text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-600"
            >
              <Icon name="visibility" filled className="text-[18px]" /> View Detected Rings
            </button>
          </div>
        </>
      )}
    </div>
  );
}
