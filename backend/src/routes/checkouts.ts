import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const checkoutsRouter = Router();

checkoutsRouter.post(
  "/checkouts",
  asyncHandler(async (req, res) => {
    const { asset_id, order_id, checked_out_by, expected_return_at } = req.body;
    if (!asset_id || !checked_out_by) {
      throw new HttpError(400, "asset_id and checked_out_by are required");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const assetResult = await client.query("SELECT * FROM assets WHERE id = $1 FOR UPDATE", [
        asset_id,
      ]);
      const asset = assetResult.rows[0];
      if (!asset) throw new HttpError(404, "Asset not found");
      if (asset.status !== "available") {
        throw new HttpError(
          409,
          `Asset is not available for checkout (current status: ${asset.status})`,
        );
      }

      const checkoutResult = await client.query(
        `INSERT INTO checkouts (asset_id, order_id, checked_out_by, expected_return_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [asset_id, order_id ?? null, checked_out_by, expected_return_at ?? null],
      );

      await client.query(
        "UPDATE assets SET status = 'checked_out', current_holder = $2 WHERE id = $1",
        [asset_id, checked_out_by],
      );

      await client.query("COMMIT");
      res.status(201).json(checkoutResult.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

checkoutsRouter.patch(
  "/checkouts/:id/return",
  asyncHandler(async (req, res) => {
    const { damage_flag, damage_note, photo_url } = req.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existingResult = await client.query("SELECT * FROM checkouts WHERE id = $1 FOR UPDATE", [
        req.params.id,
      ]);
      const existing = existingResult.rows[0];
      if (!existing) throw new HttpError(404, "Checkout not found");
      if (existing.checked_in_at) throw new HttpError(400, "This checkout was already returned");

      const checkoutResult = await client.query(
        `UPDATE checkouts
         SET checked_in_at = now(), damage_flag = $2, damage_note = $3, photo_url = $4
         WHERE id = $1
         RETURNING *`,
        [req.params.id, !!damage_flag, damage_note ?? null, photo_url ?? null],
      );

      // A damaged return goes to maintenance instead of straight back to available.
      const newAssetStatus = damage_flag ? "in_maintenance" : "available";
      await client.query(
        "UPDATE assets SET status = $2, current_holder = NULL WHERE id = $1",
        [existing.asset_id, newAssetStatus],
      );

      await client.query("COMMIT");
      res.json(checkoutResult.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

checkoutsRouter.get(
  "/checkouts/overdue",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT c.*, a.name AS asset_name
       FROM checkouts c
       JOIN assets a ON c.asset_id = a.id
       WHERE c.checked_in_at IS NULL
         AND c.expected_return_at IS NOT NULL
         AND c.expected_return_at < now()
       ORDER BY c.expected_return_at`,
    );
    res.json(result.rows);
  }),
);
