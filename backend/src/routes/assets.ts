import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const assetsRouter = Router();

const ASSET_STATUSES = [
  "available",
  "checked_out",
  "missing",
  "in_maintenance",
  "unconfirmed",
  "retired",
] as const;

// Statuses settable directly via PATCH /assets/:id/status — 'available' is
// deliberately excluded: it may only be reached through /verify, since an
// asset can't become assignable without a confirmation record.
const DIRECTLY_SETTABLE_STATUSES = ASSET_STATUSES.filter((s) => s !== "available");

assetsRouter.get(
  "/assets",
  asyncHandler(async (req, res) => {
    const { status, site_id, category } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      if (!ASSET_STATUSES.includes(status as (typeof ASSET_STATUSES)[number])) {
        throw new HttpError(400, `Invalid status. Must be one of: ${ASSET_STATUSES.join(", ")}`);
      }
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (site_id) {
      params.push(site_id);
      conditions.push(`current_site_id = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT * FROM assets ${where} ORDER BY created_at DESC`,
      params,
    );
    res.json(result.rows);
  }),
);

assetsRouter.get(
  "/assets/:id",
  asyncHandler(async (req, res) => {
    const assetResult = await pool.query("SELECT * FROM assets WHERE id = $1", [req.params.id]);
    const asset = assetResult.rows[0];
    if (!asset) throw new HttpError(404, "Asset not found");

    const checkoutsResult = await pool.query(
      "SELECT * FROM checkouts WHERE asset_id = $1 ORDER BY checked_out_at DESC",
      [req.params.id],
    );

    res.json({ ...asset, checkout_history: checkoutsResult.rows });
  }),
);

assetsRouter.post(
  "/assets",
  asyncHandler(async (req, res) => {
    const { name, category, qr_tag_id, purchase_date, condition } = req.body;
    if (!name || !category || !qr_tag_id) {
      throw new HttpError(400, "name, category, and qr_tag_id are required");
    }

    // status/last_verified_at are deliberately not accepted here — every new
    // asset starts unconfirmed until a physical verification via /verify.
    const result = await pool.query(
      `INSERT INTO assets (name, category, qr_tag_id, purchase_date, condition)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, category, qr_tag_id, purchase_date ?? null, condition ?? null],
    );
    res.status(201).json(result.rows[0]);
  }),
);

assetsRouter.patch(
  "/assets/:id/verify",
  asyncHandler(async (req, res) => {
    const { verified_by } = req.body;
    if (!verified_by) throw new HttpError(400, "verified_by is required");

    const result = await pool.query(
      `UPDATE assets
       SET status = 'available', last_verified_at = now(), verified_by = $2
       WHERE id = $1
       RETURNING *`,
      [req.params.id, verified_by],
    );
    if (!result.rows[0]) throw new HttpError(404, "Asset not found");
    res.json(result.rows[0]);
  }),
);

assetsRouter.patch(
  "/assets/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!DIRECTLY_SETTABLE_STATUSES.includes(status)) {
      throw new HttpError(
        400,
        `status must be one of: ${DIRECTLY_SETTABLE_STATUSES.join(", ")} (use /verify to set 'available')`,
      );
    }

    const result = await pool.query(
      `UPDATE assets SET status = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, status],
    );
    if (!result.rows[0]) throw new HttpError(404, "Asset not found");
    res.json(result.rows[0]);
  }),
);
