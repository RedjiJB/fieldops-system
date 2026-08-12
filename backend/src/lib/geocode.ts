// Reverse geocoding via OpenStreetMap Nominatim — free, no API key. Usage
// policy (https://operations.osmfoundation.org/policies/nominatim/) caps
// this at 1 request/sec and requires an identifying User-Agent; a small
// landscaping crew's location pings are nowhere near that ceiling as long
// as we skip re-geocoding points that haven't actually moved (see
// isNearLastGeocodedPoint in vehicles.ts).
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "FieldOps-System/1.0 (thesodboys.ca)";

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `${NOMINATIM_URL}?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { display_name?: string };
    return body.display_name ?? null;
  } catch {
    // Geocoding is best-effort — a timeout or Nominatim outage should never
    // block logging the raw coordinates.
    return null;
  }
}

export function metersBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
