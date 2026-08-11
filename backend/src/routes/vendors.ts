import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const vendorsRouter = Router();

vendorsRouter.get(
  "/vendors",
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT * FROM vendors ORDER BY name");
    res.json(result.rows);
  }),
);

vendorsRouter.post(
  "/vendors",
  asyncHandler(async (req, res) => {
    const { name, contact_method, contact_address, account_number, lead_time_days } = req.body;
    if (!name) throw new HttpError(400, "name is required");

    const result = await pool.query(
      `INSERT INTO vendors (name, contact_method, contact_address, account_number, lead_time_days)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        name,
        contact_method ?? null,
        contact_address ?? null,
        account_number ?? null,
        lead_time_days ?? null,
      ],
    );
    res.status(201).json(result.rows[0]);
  }),
);

vendorsRouter.post(
  "/purchase-orders/:id/send",
  asyncHandler(async (req, res) => {
    const { sent_to } = req.body;
    if (!sent_to) throw new HttpError(400, "sent_to is required");

    const existing = await pool.query("SELECT * FROM purchase_orders WHERE id = $1", [
      req.params.id,
    ]);
    if (!existing.rows[0]) throw new HttpError(404, "Purchase order not found");
    if (existing.rows[0].status !== "compiled") {
      throw new HttpError(
        409,
        `Purchase order must be 'compiled' to send (current status: ${existing.rows[0].status})`,
      );
    }

    const result = await pool.query(
      `UPDATE purchase_orders SET status = 'sent_to_office', sent_to = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, sent_to],
    );
    res.json(result.rows[0]);
  }),
);

vendorsRouter.patch(
  "/purchase-orders/:id/fulfilled",
  asyncHandler(async (req, res) => {
    const existing = await pool.query("SELECT * FROM purchase_orders WHERE id = $1", [
      req.params.id,
    ]);
    if (!existing.rows[0]) throw new HttpError(404, "Purchase order not found");
    if (!["sent_to_office", "forwarded_by_office"].includes(existing.rows[0].status)) {
      throw new HttpError(
        409,
        `Purchase order must be sent before it can be marked fulfilled (current status: ${existing.rows[0].status})`,
      );
    }

    // The doc's "once a receipt photo is logged" condition properly belongs to
    // the Documents module (ROADMAP.md phase 7, not yet built — there's no
    // purchase_order_id column on documents yet to link the two). Until that
    // exists, fulfillment is a direct state transition without that linkage.
    const result = await pool.query(
      `UPDATE purchase_orders SET status = 'fulfilled' WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    res.json(result.rows[0]);
  }),
);
