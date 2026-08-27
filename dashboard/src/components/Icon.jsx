export default function Icon({ name, filled, className = "" }) {
  return (
    <span
      className={`material-symbols-outlined text-xl ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  );
}
