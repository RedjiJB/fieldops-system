import { useEffect, useState } from "react";
import { api, PO_STATUSES, type PurchaseOrder, type PurchaseOrderDetail, type Vendor } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

function poStatusTone(status: (typeof PO_STATUSES)[number]): "neutral" | "warn" | "good" {
  if (status === PO_STATUSES[0]) return "neutral";
  if (status === PO_STATUSES[PO_STATUSES.length - 1]) return "good";
  return "warn";
}

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid var(--color-border)",
};
const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const };
const poLayoutStyle = { display: "flex", gap: 16 };
const poListColStyle = { width: 280, overflowY: "auto" as const, maxHeight: 400 };
const poDetailColStyle = { flex: 1 };

function VendorsSection() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<Vendor, "id"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.vendors().then(setVendors).catch((err) => setError(err instanceof Error ? err.message : "Failed to load vendors"));
  }

  useEffect(reload, []);

  function startEdit(v: Vendor) {
    setEditingId(v.id);
    setDraft({
      name: v.name,
      contact_method: v.contact_method,
      contact_address: v.contact_address,
      account_number: v.account_number,
      lead_time_days: v.lead_time_days,
    });
  }

  async function saveEdit(v: Vendor) {
    if (!draft) return;
    try {
      const updated = await api.updateVendor(v.id, draft);
      setVendors((prev) => prev.map((x) => (x.id === v.id ? { ...x, ...updated } : x)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update vendor");
    }
  }

  return (
    <section className="card">
      <h2>Vendors</h2>
      {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13 }}>{error}</div>}

      {vendors.length === 0 && <p style={{ color: "var(--color-text-muted)" }}>No vendors on file.</p>}
      {vendors.map((v) => (
        <div key={v.id} style={rowStyle}>
          {editingId === v.id && draft ? (
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const, flex: 1 }}>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" />
              <input
                value={draft.contact_method ?? ""}
                onChange={(e) => setDraft({ ...draft, contact_method: e.target.value || null })}
                placeholder="Contact method"
              />
              <input
                value={draft.contact_address ?? ""}
                onChange={(e) => setDraft({ ...draft, contact_address: e.target.value || null })}
                placeholder="Contact address"
              />
              <input
                value={draft.account_number ?? ""}
                onChange={(e) => setDraft({ ...draft, account_number: e.target.value || null })}
                placeholder="Account #"
              />
              <input
                type="number"
                value={draft.lead_time_days ?? ""}
                onChange={(e) => setDraft({ ...draft, lead_time_days: e.target.value ? Number(e.target.value) : null })}
                placeholder="Lead time (days)"
                style={{ width: 130 }}
              />
              <button className="btn-primary" onClick={() => saveEdit(v)}>Save</button>
              <button onClick={() => setEditingId(null)}>Cancel</button>
            </span>
          ) : (
            <>
              <span>
                <strong>{v.name}</strong>
                <span style={{ color: "var(--color-text-muted)" }}>
                  {v.contact_method ? ` — ${v.contact_method}` : ""}
                  {v.lead_time_days != null ? ` — ${v.lead_time_days}d lead time` : ""}
                </span>
              </span>
              <button onClick={() => startEdit(v)}>Edit</button>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

function PurchaseOrdersSection() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api
      .purchaseOrders({ status: status || undefined })
      .then(setOrders)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load purchase orders"));
  }

  useEffect(reload, [status]);

  function selectPo(id: string) {
    setSelectedId(id);
    setSentTo("");
    api
      .purchaseOrder(id)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load purchase order"));
  }

  async function refreshDetail() {
    if (!selectedId) return;
    const updated = await api.purchaseOrder(selectedId);
    setDetail(updated);
    setOrders((prev) => prev.map((o) => (o.id === selectedId ? { ...o, ...updated } : o)));
  }

  async function send() {
    if (!detail || !sentTo) {
      setError("Enter who this is being sent to first");
      return;
    }
    try {
      await api.sendPurchaseOrder(detail.id, sentTo);
      await refreshDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send purchase order");
    }
  }

  async function markFulfilled() {
    if (!detail) return;
    if (!window.confirm(`Mark PO for "${detail.vendor_name ?? "unknown vendor"}" as fulfilled?`)) return;
    try {
      await api.markPurchaseOrderFulfilled(detail.id);
      await refreshDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark fulfilled");
    }
  }

  return (
    <section className="card">
      <h2>Purchase Orders</h2>
      {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13 }}>{error}</div>}

      <div style={filterBarStyle}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {PO_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div style={poLayoutStyle}>
        <div style={poListColStyle}>
          {orders.length === 0 && <p style={{ color: "var(--color-text-muted)" }}>No purchase orders match this filter.</p>}
          {orders.map((po) => (
            <div
              key={po.id}
              onClick={() => selectPo(po.id)}
              style={{
                padding: "8px 4px",
                cursor: "pointer",
                fontWeight: selectedId === po.id ? "bold" : "normal",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              {po.vendor_name ?? "unknown vendor"} — <StatusBadge label={po.status} tone={poStatusTone(po.status)} />
            </div>
          ))}
        </div>

        <div style={poDetailColStyle}>
          {!detail && <p style={{ color: "var(--color-text-muted)" }}>Select a purchase order.</p>}
          {detail && (
            <>
              <p>
                <strong>{detail.vendor_name ?? "unknown vendor"}</strong>{" "}
                <StatusBadge label={detail.status} tone={poStatusTone(detail.status)} />
              </p>
              <p style={{ color: "var(--color-text-muted)" }}>
                {detail.site_name ? `Requested from ${detail.site_name}` : "Not linked to an order on file"}
                {detail.cost != null ? ` — cost ${detail.cost}` : ""}
                {detail.eta ? ` — eta ${detail.eta}` : ""}
                {detail.sent_to ? ` — sent to ${detail.sent_to}` : ""}
              </p>
              {detail.fulfilled_at && (
                <p style={{ color: "var(--color-text-muted)" }}>
                  Fulfilled {new Date(detail.fulfilled_at).toLocaleString()}
                  {detail.fulfilled_by_name ? ` by ${detail.fulfilled_by_name}` : ""}
                </p>
              )}

              <h3 style={{ fontSize: 14 }}>Items</h3>
              {detail.items.map((item) => (
                <div key={item.id} style={rowStyle}>
                  <span>{item.description}</span>
                </div>
              ))}

              {detail.status === "compiled" && (
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <input placeholder="Sent to" value={sentTo} onChange={(e) => setSentTo(e.target.value)} />
                  <button className="btn-primary" onClick={send}>Send</button>
                </div>
              )}
              {(detail.status === "sent_to_office" || detail.status === "forwarded_by_office") && (
                <div style={{ marginTop: 12 }}>
                  <button className="btn-primary" onClick={markFulfilled}>Mark fulfilled</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function VendorsPage() {
  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <VendorsSection />
      <PurchaseOrdersSection />
    </div>
  );
}
