import { useEffect, useState } from "react";
import { ACTIVITY_EVENT_TYPES, api, type ActivityEvent } from "../api/client";

const sectionStyle = { padding: 16 };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #f0f0f0",
};
const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const };

const EVENT_LABELS: Record<string, string> = {
  job_started: "Job started",
  job_completed: "Job completed",
  checkout_created: "Checked out",
  checkout_returned: "Returned",
  asset_verified: "Verified",
  alert_resolved: "Alert resolved",
  notification_acknowledged: "Notification acknowledged",
  document_uploaded: "Document uploaded",
};

export function ActivityLogPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [eventType, setEventType] = useState("");
  const [since, setSince] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api
      .activity({ event_type: eventType || undefined, since: since || undefined })
      .then(setEvents)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load activity"));
  }

  useEffect(reload, [eventType, since]);

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Activity Log</h2>
        <p style={{ color: "#888", fontSize: 13 }}>
          Job progress, checkouts/returns, verifications, and resolved alerts — everything with a recorded actor.
          Order and purchase-order status changes don't record who yet, so they don't appear here.
        </p>
        {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div style={filterBarStyle}>
          <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
            <option value="">All event types</option>
            {ACTIVITY_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_LABELS[t]}
              </option>
            ))}
          </select>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </div>

        {events.length === 0 && <p style={{ color: "#888" }}>No activity matches these filters.</p>}
        {events.map((e, idx) => (
          <div key={idx} style={rowStyle}>
            <span>
              <strong>{EVENT_LABELS[e.event_type] ?? e.event_type}</strong>
              <span style={{ color: "#888" }}>
                {" "}
                — {e.description} — {e.actor_name ?? "unknown actor"}
              </span>
            </span>
            <span style={{ color: "#888", fontSize: 13 }}>{new Date(e.occurred_at).toLocaleString()}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
