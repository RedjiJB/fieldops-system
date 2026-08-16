import { X } from "lucide-react";
import { useState } from "react";

// First-login orientation for dashboard users who've never seen this UI
// before -- localStorage-keyed per user id, not a DB column, since this is
// purely a one-time client-side nicety with no reason to survive a browser
// switch or need admin visibility into who's dismissed it.
function storageKey(userId: string): string {
  return `fieldops_welcome_seen_${userId}`;
}

export function WelcomeBanner({ userId, userName }: { userId: string; userName: string }) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey(userId)) === "1");

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(storageKey(userId), "1");
    setDismissed(true);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        margin: "12px 16px 0",
        background: "rgb(var(--color-accent-ch) / 0.08)",
        border: "1px solid rgb(var(--color-accent-ch) / 0.25)",
        borderRadius: "var(--radius-md)",
        fontSize: 13,
      }}
    >
      <div style={{ flex: 1 }}>
        <strong>Welcome, {userName}.</strong> This is the Sod Boys Ltd dashboard — use the sidebar to get around.
        Overview is your daily snapshot; everything else is one click away. Questions about anything you see here,
        ask Redji.
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss welcome message"
        style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2, flexShrink: 0 }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
