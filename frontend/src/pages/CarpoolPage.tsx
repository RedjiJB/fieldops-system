import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type RideRequest } from "../api/client";
import { EmptyState } from "../components/EmptyState";

const columnStyle = { flex: 1, minWidth: 280 };
const rowStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
  padding: "10px 0",
  borderBottom: "1px solid var(--color-border)",
};

// Read-only for now -- matching a need to an offer happens over WhatsApp
// (match_ride_requests), same reasoning as the rest of this feature being
// request-based rather than auto-matched. A "mark matched" control here is
// a fast-follow, not blocking.
export function CarpoolPage() {
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api
      .rideRequests({ status: "open", date: date || undefined })
      .then(setRequests)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load ride requests"));
  }

  useEffect(reload, [date]);

  const needs = requests.filter((r) => r.request_type === "need_ride");
  const offers = requests.filter((r) => r.request_type === "offering_ride");

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <section className="card">
        <h2>Carpool</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          Open ride requests posted over WhatsApp — matching a need to an offer also happens there, this is a read-only view.
        </p>
        {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div style={{ marginBottom: 16 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} placeholder="All dates" />
        </div>

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" as const }}>
          <div style={columnStyle}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Need a ride ({needs.length})</h3>
            {needs.length === 0 && <EmptyState icon={Users} title="No open requests" description="Nobody's currently asking for a ride." />}
            {needs.map((r) => (
              <div key={r.id} style={rowStyle}>
                <strong>{r.crew_member_name}</strong>
                <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                  {r.date}
                  {r.site_name ? ` — ${r.site_name}` : ""}
                </span>
                {r.notes && <span style={{ fontSize: 13 }}>{r.notes}</span>}
              </div>
            ))}
          </div>

          <div style={columnStyle}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Offering a ride ({offers.length})</h3>
            {offers.length === 0 && <EmptyState icon={Users} title="No open offers" description="Nobody's currently offering a ride." />}
            {offers.map((r) => (
              <div key={r.id} style={rowStyle}>
                <strong>{r.crew_member_name}</strong>
                <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                  {r.date}
                  {r.site_name ? ` — ${r.site_name}` : ""}
                  {r.seats_available != null ? ` — ${r.seats_available} seat${r.seats_available === 1 ? "" : "s"}` : ""}
                </span>
                {r.notes && <span style={{ fontSize: 13 }}>{r.notes}</span>}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
