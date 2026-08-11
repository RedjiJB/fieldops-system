import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const vehiclesRouter = Router();

const TELEMETRY_SOURCES = ["whatsapp_location", "obd"] as const;

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

    // WhatsApp shared location is the sole real-time source for the POC
    // (ARCHITECTURE.md) — OBD is a later upgrade, not wired up yet.
    const result = await pool.query(
      `INSERT INTO vehicle_telemetry (vehicle_id, lat, lng, source)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, lat, lng, source ?? "whatsapp_location"],
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
    if (!existing.rows[0]) throw new HttpError(404, "Trip not found");
    if (existing.rows[0].ended_at) throw new HttpError(400, "Trip already ended");

    const result = await pool.query(
      "UPDATE trips SET ended_at = now() WHERE id = $1 RETURNING *",
      [req.params.id],
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
