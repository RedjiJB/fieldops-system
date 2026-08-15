import { Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Trip, type Vehicle } from "../api/client";
import { EmptyState } from "../components/EmptyState";

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid var(--color-border)",
};

function formatDistance(meters: number | null): string {
  if (meters == null) return "no distance estimate available";
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "in progress";
  return `${Math.round(seconds / 60)} min`;
}

export function VehicleHistoryPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .vehicles()
      .then((vs) => {
        setVehicles(vs);
        if (vs[0]) setVehicleId(vs[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load vehicles"));
  }, []);

  useEffect(() => {
    if (!vehicleId) return;
    api
      .vehicleTrips(vehicleId)
      .then(setTrips)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load trips"));
  }, [vehicleId]);

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {error && <div style={{ padding: 8, color: "var(--color-status-bad)" }}>{error}</div>}

      <section className="card">
        <h2>Vehicle &amp; Trip History</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          Distance is a lower-bound estimate from WhatsApp location pings, not GPS-precise tracking.
        </p>

        <div style={{ marginBottom: 16 }}>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
              </option>
            ))}
          </select>
        </div>

        {vehicleId && trips.length === 0 && <EmptyState icon={Truck} title="No trips on record for this vehicle" description="Trips started over WhatsApp will appear here." />}
        {trips.map((t) => (
          <div key={t.id} style={rowStyle}>
            <span>
              <strong>{t.started_at ? new Date(t.started_at).toLocaleString() : "unknown start"}</strong>
              <span style={{ color: "var(--color-text-muted)" }}>{t.purpose_tag ? ` — ${t.purpose_tag}` : ""}</span>
            </span>
            <span style={{ color: "var(--color-text-muted)" }}>
              {formatDistance(t.distance_meters)} — {formatDuration(t.duration_seconds)}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
