import { useEffect, useState } from "react";
import {
  api,
  ORDER_STATUSES,
  type Alert,
  type CrewMember,
  type Notification,
  type Order,
  type OrderDetail,
  type Shift,
  type Site,
} from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type BatchShiftRow = {
  key: number;
  crew_member_id: string;
  site_id: string;
  date: string;
  start_time: string;
  end_time: string;
};

function emptyBatchRow(key: number, date: string): BatchShiftRow {
  return { key, crew_member_id: "", site_id: "", date, start_time: "", end_time: "" };
}

function BulkShiftAssignSection({ onAssigned }: { onAssigned: () => void }) {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [rows, setRows] = useState<BatchShiftRow[]>([emptyBatchRow(0, todayIso())]);
  const [nextKey, setNextKey] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.crewMembers({ active: "true" }).then(setCrew).catch(() => {});
    api.sites().then(setSites).catch(() => {});
  }, []);

  function updateRow(key: number, patch: Partial<BatchShiftRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const last = rows[rows.length - 1];
    setRows((prev) => [...prev, emptyBatchRow(nextKey, last?.date ?? todayIso())]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  async function submit() {
    setError(null);
    const incomplete = rows.some((r) => !r.crew_member_id || !r.site_id || !r.date);
    if (incomplete) {
      setError("Every row needs a crew member, site, and date.");
      return;
    }
    setSubmitting(true);
    try {
      await api.createShiftsBatch(
        rows.map((r) => ({
          crew_member_id: r.crew_member_id,
          site_id: r.site_id,
          date: r.date,
          start_time: r.start_time || undefined,
          end_time: r.end_time || undefined,
        })),
      );
      setRows([emptyBatchRow(nextKey, todayIso())]);
      setNextKey((k) => k + 1);
      onAssigned();
    } catch (err) {
      // All-or-nothing, same as the agent's assign_shifts_batch tool -- one
      // bad row means none are created, so a single error covers the batch.
      setError(err instanceof Error ? err.message : "Failed to assign shifts");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: 16 }}>Assign shifts</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        All rows are assigned together, all-or-nothing — if one row is invalid, none are created.
      </p>
      {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {rows.map((row) => (
        <div key={row.key} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" as const }}>
          <select value={row.crew_member_id} onChange={(e) => updateRow(row.key, { crew_member_id: e.target.value })}>
            <option value="">Crew member…</option>
            {crew.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select value={row.site_id} onChange={(e) => updateRow(row.key, { site_id: e.target.value })}>
            <option value="">Site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input type="date" value={row.date} onChange={(e) => updateRow(row.key, { date: e.target.value })} />
          <input
            type="time"
            value={row.start_time}
            onChange={(e) => updateRow(row.key, { start_time: e.target.value })}
            title="Start time (optional)"
          />
          <input
            type="time"
            value={row.end_time}
            onChange={(e) => updateRow(row.key, { end_time: e.target.value })}
            title="End time (optional)"
          />
          <button onClick={() => removeRow(row.key)} disabled={rows.length === 1}>
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={addRow}>+ Add row</button>
        <button onClick={submit} disabled={submitting}>
          {submitting ? "Assigning…" : `Assign ${rows.length} shift${rows.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </section>
  );
}

function nextStatus(current: Order["status"]): Order["status"] | null {
  const idx = ORDER_STATUSES.indexOf(current);
  if (idx === -1 || idx === ORDER_STATUSES.length - 1) return null;
  return ORDER_STATUSES[idx + 1];
}

function orderStatusTone(status: Order["status"]): "neutral" | "warn" | "good" {
  if (status === ORDER_STATUSES[0]) return "neutral";
  if (status === ORDER_STATUSES[ORDER_STATUSES.length - 1]) return "good";
  return "warn";
}

function OrderItemsPanel({ orderId }: { orderId: string }) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .orderDetail(orderId)
      .then((d) => {
        setDetail(d);
        setDrafts(Object.fromEntries(d.items.map((it) => [it.id, it.unit_cost === null ? "" : String(it.unit_cost)])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load order items"));
  }, [orderId]);

  async function save(itemId: string) {
    const raw = drafts[itemId];
    const value = Number(raw);
    if (raw.trim() === "" || Number.isNaN(value) || value < 0) {
      setError("unit_cost must be a non-negative number");
      return;
    }
    try {
      const updated = await api.updateOrderItem(itemId, value);
      setDetail((prev) => (prev ? { ...prev, items: prev.items.map((it) => (it.id === itemId ? updated : it)) } : prev));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save unit cost");
    }
  }

  if (!detail) return <p style={{ color: "#888", fontSize: 13 }}>Loading items…</p>;

  return (
    <div style={{ padding: "8px 0 8px 16px" }}>
      {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 6 }}>{error}</div>}
      {detail.items.length === 0 && <p style={{ color: "#888", fontSize: 13 }}>No items on this order.</p>}
      {detail.items.map((item) => (
        <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
          <span style={{ flex: 1 }}>
            {item.item_name ?? "Unknown item"} — qty {item.quantity}
          </span>
          <span>unit cost</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={drafts[item.id] ?? ""}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
            style={{ width: 80 }}
          />
          <button onClick={() => save(item.id)}>Save</button>
        </div>
      ))}
    </div>
  );
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
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [selectedAlertIds, setSelectedAlertIds] = useState<Set<string>>(new Set());
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<Set<string>>(new Set());
  const [bulkResolving, setBulkResolving] = useState(false);
  const [bulkAcknowledging, setBulkAcknowledging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    Promise.all([api.shiftsToday(), api.unresolvedAlerts(), api.orders(), api.notifications()])
      .then(([s, a, o, n]) => {
        setShifts(s);
        setAlerts(a);
        setOrders(o);
        setNotifications(n);
        // Prune rather than wipe -- a poll firing mid-selection shouldn't
        // discard checkboxes for items that are still there; only ones
        // that dropped out of the new list (someone else resolved/
        // acknowledged it, or this reload followed a bulk action of our
        // own) get deselected.
        setSelectedAlertIds((prev) => new Set([...prev].filter((id) => a.some((x) => x.id === id))));
        setSelectedNotificationIds((prev) => new Set([...prev].filter((id) => n.some((x) => x.id === id))));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load ops data"));
  }

  // This page is specifically what "a new alert won't appear until you
  // refresh" was about -- alerts/notifications/orders are the time-sensitive
  // data here, unlike most other dashboard pages (editing forms, browsing
  // history) where a background refresh would be more disruptive than
  // useful. Scoped to this page rather than every page in the app.
  useEffect(() => {
    reload();
    const interval = setInterval(reload, 30000);
    return () => clearInterval(interval);
  }, []);

  function toggleAlertSelected(id: string) {
    setSelectedAlertIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleNotificationSelected(id: string) {
    setSelectedNotificationIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function onResolve(alert: Alert) {
    if (!window.confirm(`Resolve this "${alert.type}" alert?`)) return;
    try {
      await api.resolveAlert(alert.id);
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve alert");
    }
  }

  // Independent operations, unlike shift assignment's all-or-nothing --
  // one alert failing to resolve shouldn't block the others, so this
  // reports a partial-failure count rather than aborting the batch.
  async function onBulkResolve() {
    const ids = [...selectedAlertIds];
    if (ids.length === 0) return;
    if (!window.confirm(`Resolve ${ids.length} selected alert${ids.length === 1 ? "" : "s"}?`)) return;
    setBulkResolving(true);
    setError(null);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.resolveAlert(id)));
      const succeededIds = new Set(ids.filter((_, i) => results[i].status === "fulfilled"));
      const failedCount = results.filter((r) => r.status === "rejected").length;
      setAlerts((prev) => prev.filter((a) => !succeededIds.has(a.id)));
      setSelectedAlertIds((prev) => new Set([...prev].filter((id) => !succeededIds.has(id))));
      if (failedCount > 0) setError(`${failedCount} of ${ids.length} alerts failed to resolve.`);
    } finally {
      setBulkResolving(false);
    }
  }

  async function onBulkAcknowledge() {
    const ids = [...selectedNotificationIds];
    if (ids.length === 0) return;
    if (!window.confirm(`Acknowledge ${ids.length} selected notification${ids.length === 1 ? "" : "s"}?`)) return;
    setBulkAcknowledging(true);
    setError(null);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.acknowledgeNotification(id)));
      const succeededIds = new Set(ids.filter((_, i) => results[i].status === "fulfilled"));
      const failedCount = results.filter((r) => r.status === "rejected").length;
      setNotifications((prev) =>
        prev.map((n) => (succeededIds.has(n.id) ? { ...n, acknowledged_at: new Date().toISOString() } : n)),
      );
      setSelectedNotificationIds((prev) => new Set([...prev].filter((id) => !succeededIds.has(id))));
      if (failedCount > 0) setError(`${failedCount} of ${ids.length} notifications failed to acknowledge.`);
    } finally {
      setBulkAcknowledging(false);
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

  const criticalOpenCount = notifications.filter((n) => n.priority === "critical" && !n.acknowledged_at).length;

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {error && <div style={{ padding: 8, color: "#c0392b" }}>{error}</div>}

      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-card-label">Today's shifts</span>
          <span className="kpi-card-value">{shifts.length}</span>
        </div>
        <div className={`kpi-card${alerts.length > 0 ? " status-bad" : ""}`}>
          <span className="kpi-card-label">Unresolved alerts</span>
          <span className="kpi-card-value">{alerts.length}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card-label">Order pipeline</span>
          <span className="kpi-card-value">{orders.length}</span>
        </div>
        <div className={`kpi-card${criticalOpenCount > 0 ? " status-bad" : ""}`}>
          <span className="kpi-card-label">Critical, unacknowledged</span>
          <span className="kpi-card-value">{criticalOpenCount}</span>
        </div>
      </div>

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

      <BulkShiftAssignSection onAssigned={reload} />

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Unresolved alerts</h2>
        {alerts.length === 0 && <p style={{ color: "#888" }}>No unresolved alerts.</p>}
        {selectedAlertIds.size > 0 && (
          <div style={{ marginBottom: 8 }}>
            <button onClick={onBulkResolve} disabled={bulkResolving}>
              {bulkResolving ? "Resolving…" : `Resolve ${selectedAlertIds.size} selected`}
            </button>
          </div>
        )}
        {alerts.map((a) => (
          <div key={a.id} style={rowStyle}>
            <span>
              <input
                type="checkbox"
                checked={selectedAlertIds.has(a.id)}
                onChange={() => toggleAlertSelected(a.id)}
                style={{ marginRight: 8 }}
              />
              <strong>{a.type}</strong>{" "}
              <StatusBadge label="unresolved" tone="bad" />
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
          const expanded = expandedOrderId === o.id;
          return (
            <div key={o.id}>
              <div style={rowStyle}>
                <span>
                  <button
                    onClick={() => setExpandedOrderId(expanded ? null : o.id)}
                    style={{ marginRight: 8 }}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                  <strong>{o.site_name ?? "Unknown site"}</strong>
                  <span style={{ color: "#888" }}> — requested by {o.requester_name ?? "Unknown"} — </span>
                  <StatusBadge label={o.status} tone={orderStatusTone(o.status)} />
                </span>
                {next && <button onClick={() => onAdvance(o)}>Advance to: {next}</button>}
              </div>
              {expanded && <OrderItemsPanel orderId={o.id} />}
            </div>
          );
        })}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Activity (last 24h)</h2>
        {notifications.length === 0 && <p style={{ color: "#888" }}>Nothing logged in the last 24 hours.</p>}
        {selectedNotificationIds.size > 0 && (
          <div style={{ marginBottom: 8 }}>
            <button onClick={onBulkAcknowledge} disabled={bulkAcknowledging}>
              {bulkAcknowledging ? "Acknowledging…" : `Acknowledge ${selectedNotificationIds.size} selected`}
            </button>
          </div>
        )}
        {notifications.map((n) => (
          <div key={n.id} style={rowStyle}>
            <span>
              {n.priority === "critical" && !n.acknowledged_at && (
                <input
                  type="checkbox"
                  checked={selectedNotificationIds.has(n.id)}
                  onChange={() => toggleNotificationSelected(n.id)}
                  style={{ marginRight: 8 }}
                />
              )}
              {n.priority === "critical" && (
                <>
                  <StatusBadge label="critical" tone="bad" /> {" "}
                </>
              )}
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
