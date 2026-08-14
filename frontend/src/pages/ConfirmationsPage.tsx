import { useEffect, useState } from "react";
import { api, CONFIRMATION_STATUSES, type PendingConfirmation } from "../api/client";
import { useAuth } from "../context/AuthContext";

const sectionStyle = { padding: 16 };
const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const, alignItems: "center" };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #f0f0f0",
};

const STATUS_COLORS: Record<string, string> = {
  awaiting_management: "#c9902f",
  approved: "#2e7d32",
  rejected: "#c0392b",
  expired: "#888",
};

function ReviewControl({
  confirmation,
  onDone,
}: {
  confirmation: PendingConfirmation;
  onDone: (c: PendingConfirmation) => void;
}) {
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isMileage = confirmation.action_type === "mileage_claim";

  async function approve() {
    setError(null);
    try {
      if (isMileage) {
        const value = Number(rate);
        if (rate.trim() === "" || Number.isNaN(value) || value < 0) {
          setError("rate_per_km is required");
          return;
        }
        onDone(await api.approvePendingConfirmation(confirmation.id, value));
      } else {
        onDone(await api.approvePendingConfirmation(confirmation.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    }
  }

  async function reject() {
    try {
      onDone(await api.rejectPendingConfirmation(confirmation.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    }
  }

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {isMileage && (
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="rate/km"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          style={{ width: 70 }}
        />
      )}
      <button onClick={approve}>Approve</button>
      <button onClick={reject}>Reject</button>
      {error && <span style={{ color: "#c0392b", fontSize: 13 }}>{error}</span>}
    </span>
  );
}

export function ConfirmationsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [confirmations, setConfirmations] = useState<PendingConfirmation[]>([]);
  const [statusFilter, setStatusFilter] = useState("awaiting_management");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api
      .pendingConfirmations(statusFilter || undefined)
      .then(setConfirmations)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load pending confirmations"));
  }

  useEffect(() => {
    if (isAdmin) reload();
  }, [isAdmin, statusFilter]);

  if (!isAdmin) {
    return (
      <div style={{ overflowY: "auto", flex: 1 }}>
        <section style={sectionStyle}>
          <h2 style={{ fontSize: 16 }}>Confirmations</h2>
          <p style={{ color: "#888" }}>Admin access required.</p>
        </section>
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Confirmations</h2>
        <p style={{ color: "#888", fontSize: 13 }}>
          Two-party confirm-before-execute pilot: hours, material-usage claims, checkout damage/condition claims, and
          mileage claims all need a crew member's confirmation <em>and</em> yours before they take effect. The crew
          member is told the outcome automatically once you act. Unanswered requests escalate the same way critical
          notifications already do, then expire.
        </p>
        {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div style={filterBarStyle}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {CONFIRMATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {confirmations.length === 0 && <p style={{ color: "#888" }}>No confirmations match this filter.</p>}
        {confirmations.map((c) => (
          <div key={c.id} style={rowStyle}>
            <span>
              <strong>{c.crew_member_name ?? "Unknown"}</strong>
              <span style={{ color: "#888" }}>
                {" "}
                — {c.summary} — {new Date(c.created_at).toLocaleString()}
                {c.reviewed_by_name ? ` — reviewed by ${c.reviewed_by_name}` : ""}
              </span>
              <span style={{ marginLeft: 8, color: STATUS_COLORS[c.status], fontWeight: "bold" }}>{c.status}</span>
            </span>
            {c.status === "awaiting_management" && (
              <ReviewControl
                confirmation={c}
                onDone={(updated) => setConfirmations((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
              />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
