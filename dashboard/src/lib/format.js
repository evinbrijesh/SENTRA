export function formatBurstWindow(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  const totalSec = Math.round(minutes * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !h) parts.push(`${s}s`);
  return parts.join(" ") || "0m";
}

export function timeAgo(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  if (Number.isNaN(diffMs)) return "—";
  const min = Math.floor(diffMs / 60000);
  if (min < 60) return `${Math.max(min, 1)} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr > 1 ? "s" : ""} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day > 1 ? "s" : ""} ago`;
}

export function scoreTone(score) {
  if (score >= 0.8) return "error";
  if (score >= 0.5) return "tertiary-fixed-dim";
  return "on-surface-variant";
}

export function scoreTrack(score) {
  if (score >= 0.8) return "bg-error";
  if (score >= 0.5) return "bg-tertiary";
  return "bg-outline-variant";
}

export function signalIcon(signal) {
  const map = {
    shared_device: "router",
    ip_switch: "lan",
    shared_ip: "lan",
    velocity_anomaly: "timer",
    synthetic_identity: "account_tree",
    geolocation_mismatch: "location_off",
    referral_cycle: "group",
    referral_density: "account_tree",
    pattern_normal: "info",
    signup_burst: "timer",
    referral: "group",
  };
  return map[signal] || "info";
}

export function signalLabel(signal) {
  const map = {
    shared_device: "Shared Device",
    ip_switch: "IP Switch",
    shared_ip: "Shared IP",
    velocity_anomaly: "Velocity Anomaly",
    synthetic_identity: "Synthetic Identity",
    geolocation_mismatch: "Geolocation Mismatch",
    referral_cycle: "Referral Cycle",
    referral_density: "Referral Density",
    pattern_normal: "Pattern Normal",
    signup_burst: "Signup Burst",
  };
  return map[signal] || signal.replace(/_/g, " ");
}

export function formatCurrency(amount) {
  if (amount == null || Number.isNaN(amount)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatScoreProb(score) {
  if (score == null || Number.isNaN(score)) return "0.00";
  return Number(score).toFixed(2);
}

export function scoreBandMeta(score) {
  const num = Number(score) || 0;
  if (num >= 0.8) {
    return {
      band: "CRITICAL",
      label: "Critical (≥0.80)",
      cls: "text-error border-error/30 bg-error/10",
      tone: "error",
    };
  }
  if (num >= 0.5) {
    return {
      band: "REVIEW",
      label: "Review (0.50–0.79)",
      cls: "text-tertiary border-tertiary/30 bg-tertiary/10",
      tone: "tertiary",
    };
  }
  return {
    band: "CLEARED",
    label: "Cleared (<0.50)",
    cls: "text-on-surface-variant border-outline-variant bg-surface-container",
    tone: "clean",
  };
}

const STATUS_META = {
  flagged: { label: "Flagged", cls: "bg-error-container/20 border-error/20 text-error", dot: "bg-error animate-pulse" },
  needs_review: { label: "Needs Review", cls: "bg-tertiary-container/10 border-tertiary/20 text-tertiary-fixed-dim", dot: "bg-tertiary-fixed-dim" },
  review: { label: "Needs Review", cls: "bg-tertiary-container/10 border-tertiary/20 text-tertiary-fixed-dim", dot: "bg-tertiary-fixed-dim" },
  clean: { label: "Cleared", cls: "bg-surface-container-high border-outline-variant text-on-surface-variant", dot: "check" },
  confirmed: { label: "Confirmed Fraud", cls: "bg-error text-white border-error", dot: "bg-error" },
  dismissed: { label: "Dismissed (FP)", cls: "bg-surface-container-highest text-on-surface-variant border-outline", dot: "check" },
};

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.clean;
}
