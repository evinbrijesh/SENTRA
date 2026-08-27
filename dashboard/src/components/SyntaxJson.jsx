const colorFor = (value) => {
  if (typeof value === "string") return "text-error";
  if (typeof value === "number" || typeof value === "boolean") return "text-tertiary";
  return "text-on-surface-variant";
};

function token(key, value) {
  return (
    <span key={key + value}>
      <span className="text-primary">"{key}"</span>
      <span className="text-on-surface-variant">: </span>
      <span className={colorFor(value)}>{typeof value === "string" ? `"${value}"` : String(value)}</span>
      <span className="text-on-surface-variant">,</span>
    </span>
  );
}

export default function SyntaxJson({ obj }) {
  return (
    <pre className="overflow-x-auto rounded border border-[#1E293B] bg-[#0A0C10] p-4 font-code-sm text-code-sm leading-relaxed">
      <code>{"{"}
        {Object.entries(obj).map(([k, v]) => {
          if (v && typeof v === "object" && !Array.isArray(v)) {
            return (
              <div key={k} className="pl-4">
                <span className="text-primary">"{k}"</span>
                <span className="text-on-surface-variant">: {"{"}</span>
                <div className="pl-4">
                  {Object.entries(v).map(([k2, v2]) => token(k2, v2))}
                </div>
                <span className="text-on-surface-variant">{"},"}</span>
              </div>
            );
          }
          if (Array.isArray(v)) {
            return (
              <div key={k} className="pl-4">
                <span className="text-primary">"{k}"</span>
                <span className="text-on-surface-variant">: [</span>
                <span className="text-on-surface-variant">{v.map((x) => (typeof x === "string" ? `"${x}"` : String(x))).join(", ")}</span>
                <span className="text-on-surface-variant">],</span>
              </div>
            );
          }
          return <div key={k} className="pl-4">{token(k, v)}</div>;
        })}
      {"}"}</code>
    </pre>
  );
}
