import type { ReactNode } from "react";

export type BadgeVariant = "neutral" | "blue" | "success" | "warning" | "danger" | "outline";

const TONE_CLASS: Record<Exclude<BadgeVariant, "outline">, string> = {
  neutral: "status-neutral",
  blue: "status-blue",
  success: "status-good",
  warning: "status-warn",
  danger: "status-bad",
};

export function Badge({
  children,
  variant = "neutral",
  dot = false,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
}) {
  const className = variant === "outline" ? "status-pill status-outline" : `status-pill ${TONE_CLASS[variant]}`;
  return (
    <span className={className}>
      {dot && <span className="status-pill-dot" />}
      {children}
    </span>
  );
}
