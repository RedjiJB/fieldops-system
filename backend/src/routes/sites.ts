import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const sitesRouter = Router();

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
