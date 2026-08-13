import { useEffect, useState } from "react";
import { api, ORDER_STATUSES, type Alert, type Notification, type Order, type Shift } from "../api/client";

function nextStatus(current: Order["status"]): Order["status"] | null {
  const idx = ORDER_STATUSES.indexOf(current);
  if (idx === -1 || idx === ORDER_STATUSES.length - 1) return null;
  return ORDER_STATUSES[idx + 1];
}

const sectionStyle = { padding: 16, borderBottom: "1px solid #eee" };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #f0f0f0",
};

export function OpsOverviewPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    Promise.all([api.shiftsToday(), api.unresolvedAlerts(), api.orders(), api.notifications()])
      .then(([s, a, o, n]) => {
        setShifts(s);
        setAlerts(a);
        setOrders(o);
        setNotifications(n);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load ops data"));
  }

  useEffect(reload, []);

  async function onResolve(alert: Alert) {
    if (!window.confirm(`Resolve this "${alert.type}" alert?`)) return;
    try {
      await api.resolveAlert(alert.id);
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve alert");
    }
  }

  async function onAdvance(order: Order) {
    const next = nextStatus(order.status);
    if (!next) return;
    if (!window.confirm(`Advance order ${order.id.slice(0, 8)} from "${order.status}" to "${next}"?`)) return;
    try {
      const updated = await api.advanceOrder(order.id, next);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to advance order");
    }
  }

  async function onAcknowledge(notification: Notification) {
    if (!window.confirm("Acknowledge this notification?")) return;
    try {
      const updated = await api.acknowledgeNotification(notification.id);
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? updated : n)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to acknowledge notification");
    }
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {error && <div style={{ padding: 8, color: "#c0392b" }}>{error}</div>}

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Today's shifts</h2>
        {shifts.length === 0 && <p style={{ color: "#888" }}>No shifts scheduled today.</p>}
        {shifts.map((s) => (
          <div key={s.id} style={rowStyle}>
            <span>
              <strong>{s.crew_member_name ?? "Unknown"}</strong> — {s.site_name ?? "Unknown site"}
              {s.start_time ? ` @ ${s.start_time}` : ""}
            </span>
            <span style={{ color: "#888" }}>{s.status}</span>
          </div>
        ))}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Unresolved alerts</h2>
        {alerts.length === 0 && <p style={{ color: "#888" }}>No unresolved alerts.</p>}
        {alerts.map((a) => (
          <div key={a.id} style={rowStyle}>
            <span>
              <strong>{a.type}</strong>
              <span style={{ color: "#888" }}> — raised {new Date(a.raised_at).toLocaleString()}</span>
            </span>
            <button onClick={() => onResolve(a)}>Resolve</button>
          </div>
        ))}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Order pipeline</h2>
        {orders.length === 0 && <p style={{ color: "#888" }}>No orders.</p>}
        {orders.map((o) => {
          const next = nextStatus(o.status);
          return (
            <div key={o.id} style={rowStyle}>
              <span>
                <strong>{o.site_name ?? "Unknown site"}</strong>
                <span style={{ color: "#888" }}>
                  {" "}
                  — requested by {o.requester_name ?? "Unknown"} — <em>{o.status}</em>
                </span>
              </span>
              {next && <button onClick={() => onAdvance(o)}>Advance to: {next}</button>}
            </div>
          );
        })}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Activity (last 24h)</h2>
        {notifications.length === 0 && <p style={{ color: "#888" }}>Nothing logged in the last 24 hours.</p>}
        {notifications.map((n) => (
          <div key={n.id} style={rowStyle}>
            <span>
              {n.priority === "critical" && <strong style={{ color: "#c0392b" }}>CRITICAL </strong>}
              {n.message}
              <span style={{ color: "#888" }}> — {new Date(n.created_at).toLocaleString()}</span>
              {n.acknowledged_at && <span style={{ color: "#888" }}> — acknowledged</span>}
              {n.escalated_count > 0 && <span style={{ color: "#888" }}> — escalated x{n.escalated_count}</span>}
            </span>
            {n.priority === "critical" && !n.acknowledged_at && (
              <button onClick={() => onAcknowledge(n)}>Acknowledge</button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
