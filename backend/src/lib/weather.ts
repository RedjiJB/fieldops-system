// Daily forecast via Open-Meteo — free, no API key, no request cap that
// matters at this scale (same reasoning as the Nominatim geocoding choice).
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export type DailyForecast = {
  precipitationProbabilityMax: number;
  windSpeedMaxKmh: number;
};

export async function fetchDailyForecast(lat: number, lng: number): Promise<DailyForecast | null> {
  try {
    const url =
      `${FORECAST_URL}?latitude=${lat}&longitude=${lng}` +
      `&daily=precipitation_probability_max,windspeed_10m_max&timezone=auto&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      daily?: { precipitation_probability_max?: number[]; windspeed_10m_max?: number[] };
    };
    const precip = body.daily?.precipitation_probability_max?.[0];
    const wind = body.daily?.windspeed_10m_max?.[0];
    if (precip == null || wind == null) return null;
    return { precipitationProbabilityMax: precip, windSpeedMaxKmh: wind };
  } catch {
    // Best-effort, same as reverseGeocode -- a timeout or outage should
    // never block the rest of the exceptions worker's tick.
    return null;
  }
}
