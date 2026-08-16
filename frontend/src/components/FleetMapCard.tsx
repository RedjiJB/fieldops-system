import { MapPin, Truck } from "lucide-react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";
import type { Vehicle } from "../api/client";

// Same Vite marker-asset fix the full Map page needs -- react-leaflet's
// default icon URLs don't survive bundling.
const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const DEFAULT_CENTER: [number, number] = [45.4215, -75.6972]; // Ottawa — the crew's real service area

/**
 * Map + companion list as two views of one dataset, side by side, the way
 * OpenConstructionERP pairs its projects map with a locations panel. Uses
 * the Leaflet setup this app already ships rather than pulling in a second
 * mapping library for one card.
 */
export function FleetMapCard({ vehicles, onOpenMap }: { vehicles: Vehicle[]; onOpenMap: () => void }) {
  const located = vehicles.filter((v) => v.latest_location);
  const center: [number, number] = located.length
    ? [located[0].latest_location!.lat, located[0].latest_location!.lng]
    : DEFAULT_CENTER;

  return (
    <div className="map-card-row">
      <div className="map-card">
        <div className="map-card-head">
          <span className="map-card-title">Fleet</span>
          <button className="btn-ghost btn-sm" onClick={onOpenMap}>
            Full map
          </button>
        </div>
        <div className="map-card-canvas">
          <MapContainer center={center} zoom={11} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
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
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>

      <div className="map-side-panel">
        <div className="map-card-head">
          <span className="map-card-title">Vehicles</span>
          <span className="map-side-count">{vehicles.length}</span>
        </div>
        <div className="map-side-grid">
          {vehicles.length === 0 && <p className="map-side-empty">No vehicles registered.</p>}
          {vehicles.slice(0, 6).map((v) => {
            const loc = v.latest_location;
            return (
              <div key={v.id} className="map-side-cell">
                <span className="map-side-cell-head">
                  <span className={`map-side-pin${loc ? "" : " is-dark"}`}>
                    {loc ? <MapPin size={11} /> : <Truck size={11} />}
                  </span>
                  <span className="map-side-plate">{v.plate}</span>
                </span>
                <span className="map-side-sub">
                  {loc
                    ? (loc.address ?? `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}`)
                    : "No location shared"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
