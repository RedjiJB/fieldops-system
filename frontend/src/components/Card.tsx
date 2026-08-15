import type { HTMLAttributes, ReactNode } from "react";

const PADDING_PX: Record<"none" | "sm" | "md" | "lg", number> = {
  none: 0,
  sm: 16,
  md: 24,
  lg: 32,
};

export function Card({
  padding = "md",
  hoverable = false,
  className,
  style,
  children,
  ...rest
}: {
  padding?: "none" | "sm" | "md" | "lg";
  hoverable?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const classes = ["card", hoverable && "card-hoverable", className].filter(Boolean).join(" ");
  return (
    <div
      className={classes}
      style={{ padding: PADDING_PX[padding], ...style }}
      tabIndex={hoverable ? 0 : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
