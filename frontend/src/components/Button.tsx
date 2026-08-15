import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = [VARIANT_CLASS[variant], `btn-${size}`, className].filter(Boolean).join(" ");
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : children}
    </button>
  );
}
