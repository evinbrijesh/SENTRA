import { useState } from "react";
import Icon from "./Icon.jsx";

export default function CopyButton({ text, className = "" }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={copy}
      title={copied ? "Copied!" : "Copy"}
      className={`text-outline transition-colors hover:text-primary ${className}`}
    >
      <Icon name={copied ? "check" : "content_copy"} className="text-[16px]" />
    </button>
  );
}
