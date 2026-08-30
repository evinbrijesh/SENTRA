import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import { fetchAlerts, acknowledgeAlert, triggerWebhookTest } from "../lib/api.js";
import { formatCurrency, formatScoreProb, timeAgo } from "../lib/format.js";

export default function NotificationDrawer({ isOpen, onClose, onSelectRing, onAlertCountChange }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("https://hooks.slack.com/services/SENTRA/RISK/ALERTS");
  const [webhookChannel, setWebhookChannel] = useState("#risk-sentinel-critical");
  const [webhookSending, setWebhookSending] = useState(false);
  const [webhookResult, setWebhookResult] = useState(null);

  const loadAlerts = () => {
    setLoading(true);
    fetchAlerts()
      .then((data) => {
        const list = data.alerts || [];
        setAlerts(list);
        onAlertCountChange?.(data.unread_count || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleAck = async (e, alertId) => {
    e.stopPropagation();
    try {
      await acknowledgeAlert(alertId);
      setAlerts((prev) =>
        prev.map((a) => (a.alert_id === alertId ? { ...a, acknowledged: true } : a))
      );
      const remaining = alerts.filter((a) => a.alert_id !== alertId && !a.acknowledged).length;
      onAlertCountChange?.(remaining);
    } catch {}
  };

  const handleSendWebhook = async () => {
    setWebhookSending(true);
    setWebhookResult(null);
    try {
      const res = await triggerWebhookTest(webhookUrl, webhookChannel);
      setWebhookResult(res);
    } catch (err) {
      setWebhookResult({ error: err.message || "Failed to dispatch webhook" });
    } finally {
      setWebhookSending(false);
    }
  };

  if (!isOpen) return null;

  const filtered = alerts.filter((a) => {
    if (filter === "critical") return a.severity === "CRITICAL";
    if (filter === "unread") return !a.acknowledged;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div className="flex h-full w-full max-w-md flex-col border-l border-outline-variant bg-[#11141D] text-on-surface shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon name="notifications_active" className="text-xl" />
            </div>
            <div>
              <h3 className="text-title-sm font-title-sm font-semibold">Incident Alert Center</h3>
              <p className="font-code-sm text-[11px] text-on-surface-variant">Live Risk Notifications & Paging</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            <Icon name="close" />
          </button>
        </div>

        {/* Action Bar / Filter Buttons */}
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-lowest/50 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {["all", "unread", "critical"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-1 font-code-sm text-code-sm capitalize transition-colors ${
                  filter === f
                    ? "bg-primary/20 text-primary font-medium"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={() => setWebhookModalOpen(true)}
            className="flex items-center gap-1 rounded-md border border-outline-variant bg-surface-container-high px-2.5 py-1 font-code-sm text-code-sm text-primary transition-colors hover:border-primary"
          >
            <Icon name="webhook" className="text-[14px]" />
            Test Webhook
          </button>
        </div>

        {/* Alerts List */}
        <div className="flex-1 overflow-y-auto divide-y divide-outline-variant/40 p-2">
          {loading && alerts.length === 0 ? (
            <div className="flex h-40 items-center justify-center gap-2 text-on-surface-variant">
              <Icon name="sync" className="animate-spin" /> Loading alerts…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-on-surface-variant">
              <Icon name="check_circle" className="text-3xl text-primary" />
              <p className="text-body-sm font-body-sm">No active alerts matching filter</p>
              <p className="font-code-sm text-code-sm text-on-surface-variant/60">Risk sentinel active on all endpoints</p>
            </div>
          ) : (
            filtered.map((a) => (
              <div
                key={a.alert_id}
                onClick={() => {
                  if (a.ring_id) {
                    onSelectRing?.(a.ring_id);
                    onClose();
                  }
                }}
                className={`group cursor-pointer rounded-lg p-3.5 transition-all hover:bg-surface-container-high/60 ${
                  !a.acknowledged ? "bg-surface-container-lowest/60 border-l-2 border-l-primary" : "opacity-80"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-code-sm text-[10px] font-bold uppercase tracking-wider ${
                        a.severity === "CRITICAL"
                          ? "bg-error/20 text-error border border-error/30"
                          : "bg-tertiary/20 text-tertiary border border-tertiary/30"
                      }`}
                    >
                      {a.severity}
                    </span>
                    <span className="font-data-mono text-data-mono font-medium text-on-surface">
                      Score: {formatScoreProb(a.score)}
                    </span>
                  </div>
                  <span className="font-code-sm text-[11px] text-on-surface-variant">{timeAgo(a.timestamp)}</span>
                </div>

                <h4 className="mt-1.5 text-body-sm font-body-sm font-semibold text-on-surface group-hover:text-primary">
                  {a.title}
                </h4>
                <p className="mt-1 text-body-xs font-body-xs leading-relaxed text-on-surface-variant">
                  {a.message}
                </p>

                <div className="mt-2.5 flex items-center justify-between">
                  <span className="font-code-sm text-[11px] font-medium text-tertiary">
                    {formatCurrency(a.exposure_gmv)} Exposure
                  </span>
                  <div className="flex items-center gap-2">
                    {!a.acknowledged ? (
                      <button
                        onClick={(e) => handleAck(e, a.alert_id)}
                        className="rounded border border-outline-variant bg-surface-container-high px-2 py-0.5 font-code-sm text-[11px] text-on-surface-variant hover:border-primary hover:text-primary"
                      >
                        Ack
                      </button>
                    ) : (
                      <span className="font-code-sm text-[10px] text-on-surface-variant/70">✓ Acknowledged</span>
                    )}
                    <span className="flex items-center gap-0.5 font-code-sm text-[11px] text-primary group-hover:underline">
                      Investigate <Icon name="arrow_forward" className="text-[12px]" />
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Drawer Footer */}
        <div className="border-t border-outline-variant bg-surface-container-lowest p-4">
          <div className="flex items-center justify-between text-body-xs text-on-surface-variant">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Real-time Alert Dispatch Active
            </span>
            <button onClick={loadAlerts} className="flex items-center gap-1 hover:text-primary font-code-sm">
              <Icon name="refresh" className="text-[13px]" /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Webhook Test Modal */}
      {webhookModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-outline-variant bg-[#11141D] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-outline-variant pb-3">
              <div className="flex items-center gap-2">
                <Icon name="webhook" className="text-primary" />
                <h3 className="text-title-sm font-title-sm font-semibold">Test Outbound Risk Webhook</h3>
              </div>
              <button onClick={() => setWebhookModalOpen(false)} className="text-on-surface-variant hover:text-on-surface">
                <Icon name="close" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="font-code-sm text-code-sm text-on-surface-variant">Webhook Endpoint URL</label>
                <input
                  type="text"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 font-code-sm text-body-sm text-on-surface focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="font-code-sm text-code-sm text-on-surface-variant">Slack / Alert Channel</label>
                <input
                  type="text"
                  value={webhookChannel}
                  onChange={(e) => setWebhookChannel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 font-code-sm text-body-sm text-on-surface focus:border-primary outline-none"
                />
              </div>

              {webhookResult && (
                <div className="mt-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-3 font-code-sm text-[12px]">
                  <div className="flex items-center justify-between text-emerald-400">
                    <span className="font-semibold">✓ Webhook Dispatch Simulated</span>
                    <span>HTTP 200 OK</span>
                  </div>
                  <pre className="mt-2 max-h-36 overflow-auto text-on-surface-variant text-[11px]">
                    {JSON.stringify(webhookResult.dispatched_payload || webhookResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setWebhookModalOpen(false)}
                className="rounded-lg border border-outline-variant px-4 py-2 text-body-sm hover:bg-surface-container-high"
              >
                Close
              </button>
              <button
                onClick={handleSendWebhook}
                disabled={webhookSending}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-body-sm font-medium text-on-primary hover:bg-primary/90"
              >
                {webhookSending ? <Icon name="sync" className="animate-spin" /> : <Icon name="send" />}
                Dispatch Alert Payload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
