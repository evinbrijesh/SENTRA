import Icon from "./Icon.jsx";

export default function TopNav({ systemOk = true, onOpenAlerts, unreadAlertsCount = 0 }) {
  return (
    <header className="fixed right-0 top-0 z-30 flex h-16 w-[calc(100%-260px)] items-center justify-between border-b border-outline-variant bg-surface/80 px-container-padding backdrop-blur-md">
      <div className="flex max-w-md flex-1 items-center">
        <div className="group relative flex w-full items-center rounded-lg transition-all duration-200 focus-within:ring-1 focus-within:ring-primary">
          <Icon name="search" className="absolute left-3 text-lg text-on-surface-variant transition-colors group-focus-within:text-primary" />
          <input
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pl-10 pr-4 text-body-sm font-body-sm text-on-surface outline-none transition-colors placeholder:text-outline focus:border-primary focus:ring-0"
            placeholder="Search parameters, IDs, or metrics..."
            type="text"
          />
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 rounded-full border border-surface-container-highest bg-surface-container-low px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_rgba(173,198,255,0.6)]" />
          <span className="font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
            System: {systemOk ? "Operational" : "Offline"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenAlerts}
            title="Incident Alerts"
            className="relative rounded-lg p-2 text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-primary"
          >
            <Icon name="notifications" />
            {unreadAlertsCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white shadow-sm animate-pulse">
                {unreadAlertsCount}
              </span>
            )}
          </button>
          <button className="rounded-lg p-2 text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-primary">
            <Icon name="dns" />
          </button>
          <button className="rounded-lg p-2 text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-primary">
            <Icon name="help" />
          </button>
        </div>
        <div className="h-6 w-px bg-outline-variant" />
        <div className="flex items-center gap-4">
          <button
            onClick={onOpenAlerts}
            className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2 text-body-sm font-body-sm font-medium text-on-surface transition-all hover:border-primary hover:text-primary"
          >
            <Icon name="travel_explore" className="text-lg" />
            Incident Alert Center
          </button>
          <button className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-outline-variant bg-surface-container-highest transition-all hover:ring-2 hover:ring-primary hover:ring-offset-2 hover:ring-offset-surface">
            <Icon name="person" className="text-base text-on-surface-variant" />
          </button>
        </div>
      </div>
    </header>
  );
}
