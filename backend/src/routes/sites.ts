import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const sitesRouter = Router();

// Matches the site_type enum in DATABASE_SCHEMA.md.
const SITE_TYPES = ["job_site", "depot", "vendor", "shop"] as const;

sitesRouter.get(
  "/sites",
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    if (type && !SITE_TYPES.includes(type as (typeof SITE_TYPES)[number])) {
      throw new HttpError(400, `type must be one of: ${SITE_TYPES.join(", ")}`);
    }
    const result = type
      ? await pool.query("SELECT * FROM sites WHERE type = $1 ORDER BY name", [type])
      : await pool.query("SELECT * FROM sites ORDER BY name");
    res.json(result.rows);
  }),
);

sitesRouter.get(
  "/sites/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("SELECT * FROM sites WHERE id = $1", [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, "Site not found");
    res.json(result.rows[0]);
  }),
);

sitesRouter.post(
  "/sites",
  asyncHandler(async (req, res) => {
    const {
      name,
      type,
      address,
      access_instructions,
      access_hours,
      center_lat,
      center_lng,
      geofence_radius_m,
      geofence_polygon,
      active_start,
      active_end,
    } = req.body;
    if (!name || !type) throw new HttpError(400, "name and type are required");
    if (!SITE_TYPES.includes(type)) {
      throw new HttpError(400, `type must be one of: ${SITE_TYPES.join(", ")}`);
    }

    const result = await pool.query(
      `INSERT INTO sites (name, type, address, access_instructions, access_hours, center_lat, center_lng,
                           geofence_radius_m, geofence_polygon, active_start, active_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        name,
        type,
        address ?? null,
        access_instructions ?? null,
        access_hours ?? null,
        center_lat ?? null,
        center_lng ?? null,
        geofence_radius_m ?? null,
        geofence_polygon ?? null,
        active_start ?? null,
        active_end ?? null,
      ],
    );
    res.status(201).json(result.rows[0]);
  }),
);

// Partial update -- same shape as PATCH /crew-members/:id. geofence_polygon
// is JSONB so it round-trips through COALESCE untouched like any other field.
sitesRouter.patch(
  "/sites/:id",
  asyncHandler(async (req, res) => {
    const {
      name,
      type,
      address,
      access_instructions,
      access_hours,
      center_lat,
      center_lng,
      geofence_radius_m,
      geofence_polygon,
      active_start,
      active_end,
    } = req.body;
    if (type !== undefined && !SITE_TYPES.includes(type)) {
      throw new HttpError(400, `type must be one of: ${SITE_TYPES.join(", ")}`);
    }

    const result = await pool.query(
      `UPDATE sites
       SET name = COALESCE($2, name),
           type = COALESCE($3, type),
           address = COALESCE($4, address),
           access_instructions = COALESCE($5, access_instructions),
           access_hours = COALESCE($6, access_hours),
           center_lat = COALESCE($7, center_lat),
           center_lng = COALESCE($8, center_lng),
           geofence_radius_m = COALESCE($9, geofence_radius_m),
           geofence_polygon = COALESCE($10, geofence_polygon),
           active_start = COALESCE($11, active_start),
           active_end = COALESCE($12, active_end)
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        name ?? null,
        type ?? null,
        address ?? null,
        access_instructions ?? null,
        access_hours ?? null,
        center_lat ?? null,
        center_lng ?? null,
        geofence_radius_m ?? null,
        geofence_polygon ?? null,
        active_start ?? null,
        active_end ?? null,
      ],
    );
    if (!result.rows[0]) throw new HttpError(404, "Site not found");
    res.json(result.rows[0]);
  }),
);

sitesRouter.get(
  "/sites/:id/inventory",
  asyncHandler(async (req, res) => {
    const siteResult = await pool.query("SELECT * FROM sites WHERE id = $1", [req.params.id]);
    if (!siteResult.rows[0]) throw new HttpError(404, "Site not found");

    // "Confirmed" means it's passed a physical verification, per the
    // unconfirmed-asset rule in ARCHITECTURE.md — not just assigned to this site.
    const assetsResult = await pool.query(
      `SELECT * FROM assets
       WHERE current_site_id = $1 AND last_verified_at IS NOT NULL
       ORDER BY category, name`,
      [req.params.id],
    );

    res.json({ site: siteResult.rows[0], assets: assetsResult.rows });
  }),
);
