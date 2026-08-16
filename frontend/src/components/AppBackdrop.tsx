import { useEffect, useRef } from "react";

/**
 * Layered page backdrop: base wash -> tinted top spotlight -> pointer-tracked
 * highlight -> masked dot grid. Sits behind everything (fixed, -1 z-index,
 * pointer-events none), which is what lets the cards above it use a
 * translucent surface and read as floating rather than flat.
 *
 * Re-implemented from the pattern rather than copied -- OpenConstructionERP
 * is AGPL-3.0 and this app is served over a public tunnel, so vendoring
 * their component would pull the whole frontend under that licence. The
 * technique (dot grid + spotlight, radial mask, CSS-variable pointer
 * tracking) is the part worth having; the code here is our own and tinted
 * to the Sod Boys green instead of their blue.
 */
export function AppBackdrop() {
  const ref = useRef<HTMLDivElement>(null);

  // One CSS-variable write per pointermove -- no React state, so this never
  // re-renders the tree underneath it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Skip on touch: there's no hover cursor to track, and listening would
    // just burn battery redrawing a highlight nobody can aim.
    if (!window.matchMedia("(hover: hover)").matches) return;
    function onMove(e: PointerEvent) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    }
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div ref={ref} aria-hidden="true" className="app-backdrop">
      <div className="app-backdrop-spotlight" />
      <div className="app-backdrop-pointer" />
      <div className="app-backdrop-dots" />
    </div>
  );
}
