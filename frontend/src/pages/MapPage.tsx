import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";
import { api, type Vehicle } from "../api/client";
import { useAuth } from "../context/AuthContext";

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

export function MapPage() {
  const { user, logout } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .vehicles()
      .then(setVehicles)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load vehicles"));
  }, []);

  const located = vehicles.filter((v) => v.latest_location);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          borderBottom: "1px solid #ddd",
        }}
      >
        <strong>FieldOps Dashboard</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span>{user?.name}</span>
          <button onClick={() => logout()}>Log out</button>
        </div>
      </header>
      {error && <div style={{ padding: 8, color: "#c0392b" }}>{error}</div>}
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
