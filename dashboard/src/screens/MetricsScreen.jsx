import { useEffect, useState } from "react";
import Icon from "../components/Icon.jsx";
import { fetchMetrics } from "../lib/api.js";

const CIRC = 2 * Math.PI * 15.9155;

function Ring({ pct, color, label, value, sub }) {
  const dash = (pct / 100) * CIRC;
  return (
    <div className="glass-panel group relative flex flex-col items-center justify-between overflow-hidden rounded-xl p-6">
      <div className="absolute inset-0 bg-primary/5 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="mb-4 flex w-full items-center justify-between">
        <h3 className="self-start text-title-sm font-title-sm text-on-surface-variant">{label}</h3>
      </div>
      <div className="relative flex h-32 w-32 items-center justify-center">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
          <path className="text-surface-variant" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none"
            stroke={color}
            strokeDasharray={`${dash}, ${CIRC}`}
            strokeLinecap="round"
            strokeWidth="3"
            style={{ filter: `drop-shadow(0 0 6px ${color}aa)` }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-display-lg font-display-lg">{value}<span className="text-title-sm">%</span></span>
        </div>
      </div>
      <div className="mt-4 font-code-sm text-code-sm text-on-surface-variant">{sub}</div>
    </div>
  );
}

export default function MetricsScreen() {
  const [m, setM] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchMetrics()
      .then((res) => !cancelled && setM(res))
      .catch((e) => !cancelled && setErr(e.message || "Failed to load metrics"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-on-surface-variant">
        <Icon name="error" className="text-3xl text-error" />
        <p className="font-code-sm text-code-sm">{err}</p>
      </div>
    );
  }
  if (!m) {
    return (
      <div className="flex h-64 items-center justify-center text-on-surface-variant">
        <Icon name="sync" className="animate-spin text-3xl text-primary" />
      </div>
    );
  }

  const al = m.account_level?.flagged || {};
  const fl = m.ring_level?.flagged || {};
  const nr = m.ring_level?.needs_review || {};
  const missed = m.ring_level?.missed_gt_rings || [];

  const pct = (v) => (v != null ? Math.round(v * 100) : "—");
  const pP = pct(al.precision);
  const pR = pct(al.recall);
  const pF = pct(al.f1);

  const tp = al.true_positives || 0;
  const fp = al.false_positives || 0;
  const fn = al.false_negatives || 0;
  const tn = al.true_negatives || 0;
  const n = tp + fp + fn + tn;

  const ringTp = (fl.true_positives || 0) + (nr.true_positives || 0);
  const ringFp = (fl.false_positives || 0) + (nr.false_positives || 0);
  const ringRec = ringTp / (ringTp + missed.length) || 0;
  const ringPrec = ringTp / (ringTp + ringFp) || 0;
  const ringF1 = (2 * ringPrec * ringRec) / (ringPrec + ringRec) || 0;

  const ROW_DATA = [
    {
      dot: "bg-error",
      name: "Account-level (flagged)",
      p: al.precision || 0,
      r: al.recall || 0,
      f: al.f1 || 0,
      rate: `${pct(m.false_positive_cost?.false_positive_rate)}`,
      fTone: "text-error",
    },
    {
      dot: "bg-tertiary",
      name: "Ring-level (flagged+review)",
      p: ringPrec,
      r: ringRec,
      f: ringF1,
      rate: `${missed.length} missed`,
      fTone: "text-tertiary",
    },
  ];

  return (
    <div className="flex flex-col gap-gutter">
      <div className="mt-2 flex w-full flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-headline-md font-headline-md font-bold text-on-surface">Model Evaluation</h1>
          <p className="mt-1 text-body-sm font-body-sm text-on-surface-variant">
            Reported on the held-out test split · {m.honest_note}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-gutter md:grid-cols-3">
        <Ring label="Precision" pct={pP} color="#adc6ff" value={pP} sub="held-out test" />
        <Ring label="Recall" pct={pR} color="#bcc7de" value={pR} sub="held-out test" />
        <Ring label="F1-Score" pct={pF} color="#c4c6d3" value={pF} sub="held-out test" />
      </div>

      <div className="grid grid-cols-12 gap-gutter">
        <div className="glass-panel col-span-12 flex h-[400px] flex-col rounded-xl p-6 lg:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-title-sm font-title-sm text-on-surface">Precision-Recall Curve</h3>
            <span className="font-code-sm text-code-sm text-on-surface-variant">operating point @ selected threshold</span>
          </div>
          <div className="chart-grid relative ml-8 mb-6 mt-2 flex-1 border-b border-l border-outline-variant">
            <div className="absolute bottom-0 -left-8 top-0 flex h-full flex-col justify-between pb-0.5 font-code-sm text-code-sm text-on-surface-variant">
              {["1.0", "0.8", "0.6", "0.4", "0.2", "0.0"].map((v) => <span key={v}>{v}</span>)}
            </div>
            <div className="absolute -bottom-6 left-0 right-0 flex justify-between px-1 font-code-sm text-code-sm text-on-surface-variant">
              {["0.0", "0.2", "0.4", "0.6", "0.8", "1.0"].map((v) => <span key={v}>{v}</span>)}
            </div>
            <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
              <defs>
                <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(173,198,255,0.15)" />
                  <stop offset="100%" stopColor="rgba(173,198,255,0)" />
                </linearGradient>
              </defs>
              <path d="M 0 0 Q 30 5, 60 20 T 100 80 L 100 100 L 0 100 Z" fill="url(#areaGradient)" />
              <path className="neon-glow text-primary" d="M 0 0 Q 30 5, 60 20 T 100 80" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <circle className="text-primary" cx={pR} cy={100 - pP} r="3" fill="#111318" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
            <div
              className="pointer-events-none absolute flex flex-col gap-1 rounded bg-surface px-3 py-2 shadow-lg"
              style={{ left: `${pR}%`, top: `${100 - pP}%`, transform: "translate(-50%, -120%)" }}
            >
              <span className="font-code-sm text-code-sm text-on-surface-variant">Operating point</span>
              <span className="font-data-mono text-xs text-primary">P: {al.precision?.toFixed(2)} | R: {al.recall?.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="glass-panel col-span-12 flex h-[400px] flex-col rounded-xl p-6 lg:col-span-4">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-title-sm font-title-sm text-on-surface">Confusion Matrix</h3>
            <span className="rounded bg-surface-container px-2 py-1 font-code-sm text-code-sm text-on-surface-variant">N={n.toLocaleString()}</span>
          </div>
          <div className="relative flex flex-1 flex-col items-center justify-center pt-4">
            <div className="relative z-10 grid aspect-square w-full max-w-[240px] grid-cols-2 grid-rows-2 gap-2">
              <div className="flex cursor-default flex-col items-center justify-center rounded border border-primary/30 bg-primary/20 p-2 transition-colors hover:bg-primary/30">
                <span className="mb-1 font-code-sm text-code-sm uppercase text-primary">True Pos</span>
                <span className="font-data-mono text-title-sm text-on-surface">{tp.toLocaleString()}</span>
              </div>
              <div className="flex cursor-default flex-col items-center justify-center rounded border border-error/20 bg-error/10 p-2 transition-colors hover:bg-error/20">
                <span className="mb-1 font-code-sm text-code-sm uppercase text-error">False Neg</span>
                <span className="font-data-mono text-title-sm text-on-surface">{fn.toLocaleString()}</span>
              </div>
              <div className="flex cursor-default flex-col items-center justify-center rounded border border-error/20 bg-error/10 p-2 transition-colors hover:bg-error/20">
                <span className="mb-1 font-code-sm text-code-sm uppercase text-error">False Pos</span>
                <span className="font-data-mono text-title-sm text-on-surface">{fp.toLocaleString()}</span>
              </div>
              <div className="flex cursor-default flex-col items-center justify-center rounded border border-tertiary/20 bg-tertiary/10 p-2 transition-colors hover:bg-tertiary/20">
                <span className="mb-1 font-code-sm text-code-sm uppercase text-tertiary">True Neg</span>
                <span className="font-data-mono text-title-sm text-on-surface">{tn.toLocaleString()}</span>
              </div>
            </div>
            <div className="absolute -left-6 top-1/2 -rotate-90 origin-center font-code-sm text-code-sm uppercase tracking-widest text-on-surface-variant">Actual Class</div>
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 font-code-sm text-code-sm uppercase tracking-widest text-on-surface-variant">Predicted Class</div>
          </div>
        </div>
      </div>

      <div className="glass-panel mb-8 flex w-full flex-col overflow-hidden rounded-xl">
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-lowest/50 p-6">
          <h3 className="text-title-sm font-title-sm text-on-surface">Held-out Test Performance</h3>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="min-w-[600px] w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container/30">
                {["Dataset split", "Precision", "Recall", "F1-Score", "Review Rate"].map((h, i) => (
                  <th key={h} className={`px-6 py-4 font-code-sm text-code-sm font-medium uppercase tracking-wider text-on-surface-variant ${i ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/50">
              {ROW_DATA.map((r) => (
                <tr key={r.name} className="group transition-colors hover:bg-surface-variant/30">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${r.dot}`} />
                      <span className="font-body-sm text-body-sm font-medium text-on-surface">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right font-data-mono text-data-mono text-on-surface">{r.p.toFixed(3)}</td>
                  <td className="px-6 py-4 text-right font-data-mono text-data-mono text-on-surface">{r.r.toFixed(3)}</td>
                  <td className={`px-6 py-4 text-right font-data-mono text-data-mono ${r.fTone}`}>{r.f.toFixed(3)}</td>
                  <td className="px-6 py-4 text-right font-data-mono text-data-mono text-on-surface-variant">{r.rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
