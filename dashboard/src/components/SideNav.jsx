import Icon from "./Icon.jsx";

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "rings", label: "Rings", icon: "hub" },
  { key: "metrics", label: "Metrics", icon: "monitoring" },
  { key: "audit", label: "Audit Trail", icon: "history" },
  { key: "upload", label: "Upload", icon: "upload_file" },
];

export default function SideNav({ active, onSelect }) {
  return (
    <nav className="fixed left-0 top-0 h-full z-40 flex w-[260px] flex-col border-r border-outline-variant bg-surface-dim py-6">
      <div className="mb-8 flex items-center gap-3 px-6">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-outline-variant bg-surface-container-highest">
          <Icon name="security" filled className="text-primary" />
        </div>
        <div>
          <h1 className="text-headline-md font-headline-md tracking-tight text-primary">Sentra AI</h1>
          <p className="mt-0.5 font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
            Fraud Detection
          </p>
        </div>
      </div>
      <div className="flex w-full flex-col gap-1 px-2">
        {NAV.map((item) => {
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className={`group flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                isActive
                  ? "rounded-r-lg border-l-2 border-primary bg-secondary-container/10 text-primary duration-150 active:scale-95"
                  : "rounded-lg text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              <Icon
                name={item.icon}
                filled={isActive}
                className={isActive ? undefined : "opacity-80 transition-opacity group-hover:opacity-100"}
              />
              <span className="body-sm font-body-sm">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
