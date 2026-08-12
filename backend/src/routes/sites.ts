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
    const { name, type, address, access_instructions, access_hours, center_lat, center_lng, geofence_radius_m } =
      req.body;
    if (!name || !type) throw new HttpError(400, "name and type are required");
    if (!SITE_TYPES.includes(type)) {
      throw new HttpError(400, `type must be one of: ${SITE_TYPES.join(", ")}`);
    }

    const result = await pool.query(
      `INSERT INTO sites (name, type, address, access_instructions, access_hours, center_lat, center_lng, geofence_radius_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
      ],
    );
    res.status(201).json(result.rows[0]);
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
