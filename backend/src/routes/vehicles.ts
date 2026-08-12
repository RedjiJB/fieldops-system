import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { metersBetween, reverseGeocode } from "../lib/geocode.js";
import { haversineDistanceMeters } from "../lib/geo.js";

export const vehiclesRouter = Router();

const TELEMETRY_SOURCES = ["whatsapp_location", "obd"] as const;

// Reuse the last resolved address instead of re-geocoding when a vehicle
// hasn't meaningfully moved — keeps well within Nominatim's 1 req/sec free
// usage policy even if a crew member's live location pings every few minutes.
const GEOCODE_REUSE_RADIUS_METERS = 100;

// GET /vehicles/:id needs the crew member's assigned vehicle to resolve
// "which vehicle is this WhatsApp location share for" — there was no way
// to look up a vehicle at all before this (same gap crew-members/sites had).
vehiclesRouter.get(
  "/vehicles",
  asyncHandler(async (req, res) => {
    const { assigned_crew_id, plate } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (assigned_crew_id) {
      params.push(assigned_crew_id);
      conditions.push(`v.assigned_crew_id = $${params.length}`);
    }
    if (plate) {
      params.push(plate);
      conditions.push(`v.plate = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    // LATERAL join pulls each vehicle's latest telemetry row in the same
    // query — the map view needs every vehicle's location in one call,
    // not the N+1 pattern GET /vehicles/:id uses for a single vehicle.
    const result = await pool.query(
      `SELECT v.*, lt.latest_location
       FROM vehicles v
       LEFT JOIN LATERAL (
         SELECT to_jsonb(t) AS latest_location
         FROM vehicle_telemetry t
         WHERE t.vehicle_id = v.id
         ORDER BY t.timestamp DESC
         LIMIT 1
       ) lt ON true
       ${where}
       ORDER BY v.plate`,
      params,
    );
    res.json(result.rows);
  }),
);

vehiclesRouter.get(
  "/vehicles/:id",
  asyncHandler(async (req, res) => {
    const vehicleResult = await pool.query("SELECT * FROM vehicles WHERE id = $1", [req.params.id]);
    const vehicle = vehicleResult.rows[0];
    if (!vehicle) throw new HttpError(404, "Vehicle not found");

    const latestLocationResult = await pool.query(
      "SELECT * FROM vehicle_telemetry WHERE vehicle_id = $1 ORDER BY timestamp DESC LIMIT 1",
      [req.params.id],
    );

    res.json({ ...vehicle, latest_location: latestLocationResult.rows[0] ?? null });
  }),
);

vehiclesRouter.post(
  "/vehicles",
  asyncHandler(async (req, res) => {
    const { plate, assigned_crew_id, current_mileage } = req.body;
    if (!plate) throw new HttpError(400, "plate is required");

    const result = await pool.query(
      `INSERT INTO vehicles (plate, assigned_crew_id, current_mileage)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [plate, assigned_crew_id ?? null, current_mileage ?? null],
    );
    res.status(201).json(result.rows[0]);
  }),
);

vehiclesRouter.post(
  "/vehicles/:id/telemetry",
  asyncHandler(async (req, res) => {
    const { lat, lng, source } = req.body;
    if (typeof lat !== "number" || typeof lng !== "number") {
      throw new HttpError(400, "lat and lng (numbers) are required");
    }
    if (source && !TELEMETRY_SOURCES.includes(source)) {
      throw new HttpError(400, `source must be one of: ${TELEMETRY_SOURCES.join(", ")}`);
    }

    const vehicle = await pool.query("SELECT id FROM vehicles WHERE id = $1", [req.params.id]);
    if (!vehicle.rows[0]) throw new HttpError(404, "Vehicle not found");

    const lastPoint = await pool.query(
      "SELECT lat, lng, address FROM vehicle_telemetry WHERE vehicle_id = $1 ORDER BY timestamp DESC LIMIT 1",
      [req.params.id],
    );
    const last = lastPoint.rows[0] as { lat: number; lng: number; address: string | null } | undefined;

    let address: string | null;
    if (last?.address && metersBetween(lat, lng, last.lat, last.lng) < GEOCODE_REUSE_RADIUS_METERS) {
      address = last.address;
    } else {
      address = await reverseGeocode(lat, lng);
    }

    // WhatsApp shared location is the sole real-time source for the POC
    // (ARCHITECTURE.md) — OBD is a later upgrade, not wired up yet.
    const result = await pool.query(
      `INSERT INTO vehicle_telemetry (vehicle_id, lat, lng, source, address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, lat, lng, source ?? "whatsapp_location", address],
    );
    res.status(201).json(result.rows[0]);
  }),
);

vehiclesRouter.post(
  "/trips",
  asyncHandler(async (req, res) => {
    const { vehicle_id, driver_id, purpose_tag, site_id } = req.body;
    if (!vehicle_id || !driver_id) {
      throw new HttpError(400, "vehicle_id and driver_id are required");
    }

    const openTrip = await pool.query(
      "SELECT id FROM trips WHERE vehicle_id = $1 AND ended_at IS NULL",
      [vehicle_id],
    );
    if (openTrip.rows[0]) {
      throw new HttpError(409, "This vehicle already has an open trip — end it before starting another");
    }

    const result = await pool.query(
      `INSERT INTO trips (vehicle_id, driver_id, purpose_tag, site_id, started_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING *`,
      [vehicle_id, driver_id, purpose_tag ?? null, site_id ?? null],
    );
    res.status(201).json(result.rows[0]);
  }),
);

vehiclesRouter.patch(
  "/trips/:id/end",
  asyncHandler(async (req, res) => {
    const existing = await pool.query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
    const trip = existing.rows[0];
    if (!trip) throw new HttpError(404, "Trip not found");
    if (trip.ended_at) throw new HttpError(400, "Trip already ended");

    const endedAtResult = await pool.query("SELECT now() AS now");
    const endedAt: Date = endedAtResult.rows[0].now;
    const durationSeconds = Math.round((endedAt.getTime() - new Date(trip.started_at).getTime()) / 1000);

    // Telemetry is WhatsApp-share-driven, not continuous GPS -- summing
    // haversine distance between consecutive points in the trip window is a
    // lower-bound estimate, not a GPS-accurate reading. Fewer than 2 points
    // means no distance data at all (NULL), not zero movement.
    const telemetryResult = await pool.query(
      `SELECT lat, lng FROM vehicle_telemetry
       WHERE vehicle_id = $1 AND timestamp >= $2 AND timestamp <= $3
       ORDER BY timestamp ASC`,
      [trip.vehicle_id, trip.started_at, endedAt],
    );
    let distanceMeters: number | null = null;
    if (telemetryResult.rows.length >= 2) {
      distanceMeters = 0;
      for (let i = 1; i < telemetryResult.rows.length; i++) {
        const prev = telemetryResult.rows[i - 1];
        const curr = telemetryResult.rows[i];
        distanceMeters += haversineDistanceMeters(prev.lat, prev.lng, curr.lat, curr.lng);
      }
    }

    const result = await pool.query(
      `UPDATE trips SET ended_at = $2, distance_meters = $3, duration_seconds = $4 WHERE id = $1 RETURNING *`,
      [req.params.id, endedAt, distanceMeters, durationSeconds],
    );
    res.json(result.rows[0]);
  }),
);

vehiclesRouter.get(
  "/vehicles/:id/trips",
  asyncHandler(async (req, res) => {
    const vehicle = await pool.query("SELECT id FROM vehicles WHERE id = $1", [req.params.id]);
    if (!vehicle.rows[0]) throw new HttpError(404, "Vehicle not found");

    const result = await pool.query(
      "SELECT * FROM trips WHERE vehicle_id = $1 ORDER BY started_at DESC",
      [req.params.id],
    );
    res.json(result.rows);
  }),
);
