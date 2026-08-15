import type { LucideIcon } from "lucide-react";

type Tone = "default" | "blue" | "success" | "warning" | "danger";

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  tintValue = false,
  delta,
  deltaDirection,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  tone?: Tone;
  /** Also color the value text by tone, not just the icon chip -- use for figures where the number itself is the alarm (e.g. a critical count). */
  tintValue?: boolean;
  delta?: string;
  deltaDirection?: "up" | "down";
}) {
  return (
    <div className={`stat-card tone-${tone}${tintValue ? " tint-value" : ""}`}>
      <div className="stat-card-body">
        <span className="stat-card-label">{label}</span>
        <span className="stat-card-value">{value}</span>
        {sub && <span className="stat-card-sub">{sub}</span>}
        {delta && (
          <span className={`stat-card-delta ${deltaDirection === "down" ? "delta-down" : "delta-up"}`}>
            {deltaDirection === "down" ? "▾" : "▴"} {delta}
          </span>
        )}
      </div>
      {Icon && (
        <span className="stat-card-icon-chip">
          <Icon size={16} />
        </span>
      )}
    </div>
  );
}
