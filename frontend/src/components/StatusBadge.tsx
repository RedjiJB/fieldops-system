type Tone = "good" | "warn" | "bad" | "neutral";

export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`status-pill status-${tone}`}>{label}</span>;
}
