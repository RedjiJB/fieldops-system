export function Skeleton({ width, height = 14, radius = "sm" }: { width?: number | string; height?: number; radius?: "sm" | "md" | "pill" }) {
  return (
    <span
      className={`skeleton skeleton-${radius}`}
      style={{ width: width ?? "100%", height }}
    />
  );
}

/** A handful of Skeleton rows, for a list/card that's still loading. */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-rows">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton width="60%" />
          <Skeleton width={70} />
        </div>
      ))}
    </div>
  );
}
