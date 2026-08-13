import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const consumablesRouter = Router();

const STOCKING_TYPES = ["stocked", "per_job_delivery"] as const;

consumablesRouter.get(
  "/consumables",
  asyncHandler(async (req, res) => {
    const { stocking_type } = req.query;
    if (stocking_type && !STOCKING_TYPES.includes(stocking_type as (typeof STOCKING_TYPES)[number])) {
      throw new HttpError(400, `Invalid stocking_type. Must be one of: ${STOCKING_TYPES.join(", ")}`);
    }

    const result = stocking_type
      ? await pool.query("SELECT * FROM consumables WHERE stocking_type = $1 ORDER BY name", [
          stocking_type,
        ])
      : await pool.query("SELECT * FROM consumables ORDER BY name");

    res.json(result.rows);
  }),
);

consumablesRouter.patch(
  "/consumables/:id/quantity",
  asyncHandler(async (req, res) => {
    const { delta } = req.body;
    if (typeof delta !== "number") throw new HttpError(400, "delta (number) is required");

    const existing = await pool.query("SELECT * FROM consumables WHERE id = $1", [req.params.id]);
    const consumable = existing.rows[0];
    if (!consumable) throw new HttpError(404, "Consumable not found");

    // per_job_delivery items don't carry quantity_on_hand — they're ordered fresh per job.
    if (consumable.stocking_type !== "stocked") {
      throw new HttpError(
        400,
        "Only 'stocked' consumables carry an on-hand quantity; per_job_delivery items are ordered per job",
      );
    }

    const result = await pool.query(
      `UPDATE consumables
       SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + $2, last_verified_at = now()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, delta],
    );
    res.json(result.rows[0]);
  }),
);

// Real transaction-time prices, not a static unit_cost -- feeds future
// job-costing/period-close reporting. No frontend view built for this yet.
consumablesRouter.get(
  "/consumables/:id/price-history",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT oi.id AS order_item_id, oi.order_id, oi.quantity, oi.unit_cost, o.created_at AS order_date
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.consumable_id = $1 AND oi.unit_cost IS NOT NULL
       ORDER BY o.created_at DESC`,
      [req.params.id],
    );
    res.json(result.rows);
  }),
);
