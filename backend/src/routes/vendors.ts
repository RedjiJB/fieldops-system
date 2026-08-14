import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const vendorsRouter = Router();

// Exported so confirmations.ts's approvePurchaseOrderFulfillment can
// re-validate the exact same precondition at approval time -- one copy of
// the business rule, not two independent ones that could drift.
export const PO_FULFILLABLE_STATUSES = ["sent_to_office", "forwarded_by_office"] as const;

vendorsRouter.get(
  "/vendors",
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT * FROM vendors ORDER BY name");
    res.json(result.rows);
  }),
);

vendorsRouter.get(
  "/vendors/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("SELECT * FROM vendors WHERE id = $1", [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, "Vendor not found");
    res.json(result.rows[0]);
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

// Partial update -- same shape as every other PATCH this session.
vendorsRouter.patch(
  "/vendors/:id",
  asyncHandler(async (req, res) => {
    const { name, contact_method, contact_address, account_number, lead_time_days } = req.body;
    const result = await pool.query(
      `UPDATE vendors
       SET name = COALESCE($2, name),
           contact_method = COALESCE($3, contact_method),
           contact_address = COALESCE($4, contact_address),
           account_number = COALESCE($5, account_number),
           lead_time_days = COALESCE($6, lead_time_days)
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        name ?? null,
        contact_method ?? null,
        contact_address ?? null,
        account_number ?? null,
        lead_time_days ?? null,
      ],
    );
    if (!result.rows[0]) throw new HttpError(404, "Vendor not found");
    res.json(result.rows[0]);
  }),
);

// List, joined to vendor name and (nullable, pre-migration POs won't have
// one) the order's site -- lets the dashboard show "who asked for this".
vendorsRouter.get(
  "/purchase-orders",
  asyncHandler(async (req, res) => {
    const { status, vendor_id } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`po.status = $${params.length}`);
    }
    if (vendor_id) {
      params.push(vendor_id);
      conditions.push(`po.vendor_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT po.*, v.name AS vendor_name, o.site_id, s.name AS site_name
       FROM purchase_orders po
       LEFT JOIN vendors v ON v.id = po.vendor_id
       LEFT JOIN orders o ON o.id = po.order_id
       LEFT JOIN sites s ON s.id = o.site_id
       ${where}
       ORDER BY po.created_at DESC`,
      params,
    );
    res.json(result.rows);
  }),
);

vendorsRouter.get(
  "/purchase-orders/:id",
  asyncHandler(async (req, res) => {
    const poResult = await pool.query(
      `SELECT po.*, v.name AS vendor_name, o.site_id, s.name AS site_name
       FROM purchase_orders po
       LEFT JOIN vendors v ON v.id = po.vendor_id
       LEFT JOIN orders o ON o.id = po.order_id
       LEFT JOIN sites s ON s.id = o.site_id
       WHERE po.id = $1`,
      [req.params.id],
    );
    const po = poResult.rows[0];
    if (!po) throw new HttpError(404, "Purchase order not found");

    const itemsResult = await pool.query(
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY description",
      [req.params.id],
    );
    res.json({ ...po, items: itemsResult.rows });
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
    if (!PO_FULFILLABLE_STATUSES.includes(existing.rows[0].status)) {
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
