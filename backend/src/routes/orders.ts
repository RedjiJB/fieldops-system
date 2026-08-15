import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { insertNotification } from "../lib/notify.js";

export const ordersRouter = Router();

const ORDER_STATUSES = ["requested", "confirmed", "picked", "loaded", "in_field", "returned"] as const;
const TRANSFER_STATUSES = ["requested", "in_transit", "completed"] as const;

interface OrderItemInput {
  asset_id?: string;
  consumable_id?: string;
  quantity: number;
}

function validateOrderItems(items: unknown): OrderItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "items must be a non-empty array");
  }
  for (const item of items) {
    const hasAsset = !!item.asset_id;
    const hasConsumable = !!item.consumable_id;
    if (hasAsset === hasConsumable) {
      throw new HttpError(400, "each item needs exactly one of asset_id or consumable_id");
    }
    if (typeof item.quantity !== "number" || item.quantity <= 0) {
      throw new HttpError(400, "each item needs a positive numeric quantity");
    }
  }
  return items;
}

ordersRouter.post(
  "/orders",
  asyncHandler(async (req, res) => {
    const { requester_id, site_id, date_needed, spec_notes, items } = req.body;
    if (!requester_id) throw new HttpError(400, "requester_id is required");
    const validItems = validateOrderItems(items);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const orderResult = await client.query(
        `INSERT INTO orders (requester_id, site_id, date_needed, spec_notes)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [requester_id, site_id ?? null, date_needed ?? null, spec_notes ?? null],
      );
      const order = orderResult.rows[0];

      const insertedItems = [];
      for (const item of validItems) {
        const itemResult = await client.query(
          `INSERT INTO order_items (order_id, asset_id, consumable_id, quantity)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [order.id, item.asset_id ?? null, item.consumable_id ?? null, item.quantity],
        );
        insertedItems.push(itemResult.rows[0]);
      }

      await client.query("COMMIT");
      res.status(201).json({ ...order, items: insertedItems });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

ordersRouter.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const { status, site_id } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      if (!ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
        throw new HttpError(400, `Invalid status. Must be one of: ${ORDER_STATUSES.join(", ")}`);
      }
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }
    if (site_id) {
      params.push(site_id);
      conditions.push(`o.site_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    // Joined names are for the dashboard's ops overview — a raw
    // site_id/requester_id UUID is useless on a management screen. Purely
    // additive: the agent's list_orders tool just gets extra fields.
    const result = await pool.query(
      `SELECT o.*, s.name AS site_name, cm.name AS requester_name
       FROM orders o
       LEFT JOIN sites s ON s.id = o.site_id
       LEFT JOIN crew_members cm ON cm.id = o.requester_id
       ${where}
       ORDER BY o.created_at DESC`,
      params,
    );
    res.json(result.rows);
  }),
);

ordersRouter.get(
  "/orders/:id",
  asyncHandler(async (req, res) => {
    const orderResult = await pool.query(
      `SELECT o.*, s.name AS site_name, cm.name AS requester_name
       FROM orders o
       LEFT JOIN sites s ON s.id = o.site_id
       LEFT JOIN crew_members cm ON cm.id = o.requester_id
       WHERE o.id = $1`,
      [req.params.id],
    );
    const order = orderResult.rows[0];
    if (!order) throw new HttpError(404, "Order not found");

    const itemsResult = await pool.query(
      `SELECT oi.*, COALESCE(a.name, c.name) AS item_name
       FROM order_items oi
       LEFT JOIN assets a ON oi.asset_id = a.id
       LEFT JOIN consumables c ON oi.consumable_id = c.id
       WHERE oi.order_id = $1
       ORDER BY oi.id`,
      [req.params.id],
    );

    res.json({ ...order, items: itemsResult.rows });
  }),
);

// Not admin-gated -- material cost is operational cost data, same as
// purchase_orders.cost, not wage/cash-handling data.
ordersRouter.patch(
  "/order-items/:id",
  asyncHandler(async (req, res) => {
    const { unit_cost } = req.body;
    if (unit_cost === undefined || unit_cost === null) {
      throw new HttpError(400, "unit_cost is required");
    }
    if (unit_cost < 0) throw new HttpError(400, "unit_cost cannot be negative");

    const result = await pool.query(
      `UPDATE order_items SET unit_cost = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, unit_cost],
    );
    if (!result.rows[0]) throw new HttpError(404, "Order item not found");
    res.json(result.rows[0]);
  }),
);

ordersRouter.patch(
  "/orders/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!ORDER_STATUSES.includes(status)) {
      throw new HttpError(400, `status must be one of: ${ORDER_STATUSES.join(", ")}`);
    }

    const existing = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, "Order not found");

    const currentIndex = ORDER_STATUSES.indexOf(existing.rows[0].status);
    const newIndex = ORDER_STATUSES.indexOf(status);
    if (newIndex <= currentIndex) {
      throw new HttpError(
        400,
        `Orders can only advance forward: '${existing.rows[0].status}' -> '${status}' is not a forward move`,
      );
    }

    const result = await pool.query(
      `UPDATE orders o SET status = $2 WHERE o.id = $1
       RETURNING o.*, (SELECT name FROM sites WHERE id = o.site_id) AS site_name`,
      [req.params.id, status],
    );
    const order = result.rows[0];
    const forSite = order.site_name ? ` for ${order.site_name}` : "";
    await insertNotification(pool, "routine", `Order${forSite} moved to ${status}.`, "order", order.id);
    delete order.site_name;
    res.json(order);
  }),
);

ordersRouter.post(
  "/orders/:id/compile-po",
  asyncHandler(async (req, res) => {
    const { vendor_id, sent_to, eta, cost } = req.body;
    if (!vendor_id || !sent_to) throw new HttpError(400, "vendor_id and sent_to are required");

    const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
    if (!orderResult.rows[0]) throw new HttpError(404, "Order not found");

    const itemsResult = await pool.query(
      `SELECT oi.id, oi.quantity, COALESCE(a.name, c.name) AS item_name
       FROM order_items oi
       LEFT JOIN assets a ON oi.asset_id = a.id
       LEFT JOIN consumables c ON oi.consumable_id = c.id
       WHERE oi.order_id = $1`,
      [req.params.id],
    );
    if (itemsResult.rows.length === 0) throw new HttpError(400, "Order has no items to compile");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const poResult = await client.query(
        `INSERT INTO purchase_orders (vendor_id, cost, eta, sent_to, order_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [vendor_id, cost ?? null, eta ?? null, sent_to, req.params.id],
      );
      const po = poResult.rows[0];

      const insertedItems = [];
      for (const item of itemsResult.rows) {
        const itemResult = await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, description, quantity, order_item_id)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [po.id, `${item.item_name} x ${item.quantity}`, item.quantity, item.id],
        );
        insertedItems.push(itemResult.rows[0]);
      }

      await client.query("COMMIT");
      res.status(201).json({ ...po, items: insertedItems });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

ordersRouter.post(
  "/transfers",
  asyncHandler(async (req, res) => {
    const { asset_id, from_site_id, to_site_id, requested_by } = req.body;
    if (!asset_id || !from_site_id || !to_site_id || !requested_by) {
      throw new HttpError(400, "asset_id, from_site_id, to_site_id, and requested_by are required");
    }

    const assetResult = await pool.query("SELECT * FROM assets WHERE id = $1", [asset_id]);
    const asset = assetResult.rows[0];
    if (!asset) throw new HttpError(404, "Asset not found");
    if (asset.current_site_id !== from_site_id) {
      throw new HttpError(
        409,
        `Asset is not currently at from_site_id (currently at: ${asset.current_site_id ?? "no site on record"})`,
      );
    }

    const result = await pool.query(
      `INSERT INTO transfers (asset_id, from_site_id, to_site_id, requested_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [asset_id, from_site_id, to_site_id, requested_by],
    );
    res.status(201).json(result.rows[0]);
  }),
);

ordersRouter.patch(
  "/transfers/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!TRANSFER_STATUSES.includes(status)) {
      throw new HttpError(400, `status must be one of: ${TRANSFER_STATUSES.join(", ")}`);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existingResult = await client.query("SELECT * FROM transfers WHERE id = $1 FOR UPDATE", [
        req.params.id,
      ]);
      const existing = existingResult.rows[0];
      if (!existing) throw new HttpError(404, "Transfer not found");

      const currentIndex = TRANSFER_STATUSES.indexOf(existing.status);
      const newIndex = TRANSFER_STATUSES.indexOf(status);
      if (newIndex <= currentIndex) {
        throw new HttpError(
          400,
          `Transfers can only advance forward: '${existing.status}' -> '${status}' is not a forward move`,
        );
      }

      const transferResult = await client.query(
        "UPDATE transfers SET status = $2 WHERE id = $1 RETURNING *",
        [req.params.id, status],
      );

      // Completing a transfer is what actually moves the asset's recorded location.
      if (status === "completed") {
        await client.query("UPDATE assets SET current_site_id = $2 WHERE id = $1", [
          existing.asset_id,
          existing.to_site_id,
        ]);
      }

      await client.query("COMMIT");
      res.json(transferResult.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);
