import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";
import { api, type Vehicle } from "../api/client";

// react-leaflet's default marker icon doesn't resolve correctly under Vite's
// bundling without this — a well-known gotcha, not a workaround for a bug
// in our code.
const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const DEFAULT_CENTER: [number, number] = [45.4215, -75.6972]; // Ottawa — matches the crew's real service area

const POLL_INTERVAL_MS = 15000;

export function MapPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Vehicle position is the one thing on this dashboard that's actually
  // moving in the real world while someone's looking at it -- polling here
  // matters more than most pages. The underlying data is WhatsApp
  // share-driven and historically sparse in practice (see
  // docs/EXCEPTION_HANDLING.md's vehicle_dark note), so this won't produce
  // a smoothly animating map, but a marker's position updates within
  // POLL_INTERVAL_MS of new telemetry landing, not only on manual refresh.
  useEffect(() => {
    function reload() {
      api
        .vehicles()
        .then((v) => {
          setVehicles(v);
          setLastUpdated(new Date());
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to load vehicles"));
    }
    reload();
    const interval = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const located = vehicles.filter((v) => v.latest_location);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {error && <div style={{ padding: 8, color: "#c0392b" }}>{error}</div>}
      {lastUpdated && (
        <div style={{ padding: "4px 8px", fontSize: 12, color: "#888" }}>
          Live — updated {lastUpdated.toLocaleTimeString()}
        </div>
      )}
      <div style={{ flex: 1 }}>
        <MapContainer center={DEFAULT_CENTER} zoom={11} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {located.map((v) => (
            <Marker key={v.id} position={[v.latest_location!.lat, v.latest_location!.lng]} icon={defaultIcon}>
              <Popup>
                <strong>{v.plate}</strong>
                <br />
                {v.latest_location!.address ?? `${v.latest_location!.lat}, ${v.latest_location!.lng}`}
                <br />
                <small>{new Date(v.latest_location!.timestamp).toLocaleString()}</small>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
