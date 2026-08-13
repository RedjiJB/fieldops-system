import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const loadoutsRouter = Router();

interface LoadoutItemInput {
  asset_id?: string;
  consumable_id?: string;
  quantity: number;
  scales_with_crew?: boolean;
}

function validateItem(item: LoadoutItemInput): LoadoutItemInput {
  const hasAsset = !!item.asset_id;
  const hasConsumable = !!item.consumable_id;
  if (hasAsset === hasConsumable) {
    throw new HttpError(400, "each item needs exactly one of asset_id or consumable_id");
  }
  if (typeof item.quantity !== "number" || item.quantity <= 0) {
    throw new HttpError(400, "each item needs a positive numeric quantity");
  }
  return item;
}

function validateItems(items: unknown): LoadoutItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "items must be a non-empty array");
  }
  return items.map(validateItem);
}

loadoutsRouter.get(
  "/loadouts",
  asyncHandler(async (req, res) => {
    const { job_type_id } = req.query;
    const result = job_type_id
      ? await pool.query("SELECT * FROM loadouts WHERE job_type_id = $1 ORDER BY name", [
          job_type_id,
        ])
      : await pool.query("SELECT * FROM loadouts ORDER BY name");
    res.json(result.rows);
  }),
);

// Shared by GET /loadouts/:id and GET /loadouts/:id/resolve -- same item
// join, resolve additionally scales quantity by crew_size.
async function fetchLoadoutItems(loadoutId: string) {
  const result = await pool.query(
    `SELECT
       li.id, li.asset_id, li.consumable_id, li.quantity, li.scales_with_crew,
       COALESCE(a.name, c.name) AS item_name
     FROM loadout_items li
     LEFT JOIN assets a ON li.asset_id = a.id
     LEFT JOIN consumables c ON li.consumable_id = c.id
     WHERE li.loadout_id = $1
     ORDER BY item_name`,
    [loadoutId],
  );
  return result.rows;
}

loadoutsRouter.get(
  "/loadouts/:id",
  asyncHandler(async (req, res) => {
    const loadoutResult = await pool.query("SELECT * FROM loadouts WHERE id = $1", [req.params.id]);
    const loadout = loadoutResult.rows[0];
    if (!loadout) throw new HttpError(404, "Loadout not found");

    const items = await fetchLoadoutItems(req.params.id);
    res.json({ ...loadout, items });
  }),
);

loadoutsRouter.post(
  "/loadouts",
  asyncHandler(async (req, res) => {
    const { name, job_type_id, items } = req.body;
    if (!name) throw new HttpError(400, "name is required");
    const validItems = validateItems(items);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const loadoutResult = await client.query(
        "INSERT INTO loadouts (name, job_type_id) VALUES ($1, $2) RETURNING *",
        [name, job_type_id ?? null],
      );
      const loadout = loadoutResult.rows[0];

      const insertedItems = [];
      for (const item of validItems) {
        const itemResult = await client.query(
          `INSERT INTO loadout_items (loadout_id, asset_id, consumable_id, quantity, scales_with_crew)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            loadout.id,
            item.asset_id ?? null,
            item.consumable_id ?? null,
            item.quantity,
            item.scales_with_crew ?? false,
          ],
        );
        insertedItems.push(itemResult.rows[0]);
      }

      await client.query("COMMIT");
      res.status(201).json({ ...loadout, items: insertedItems });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

loadoutsRouter.get(
  "/loadouts/:id/resolve",
  asyncHandler(async (req, res) => {
    const crewSize = Number(req.query.crew_size);
    if (!Number.isInteger(crewSize) || crewSize <= 0) {
      throw new HttpError(400, "crew_size (positive integer) query param is required");
    }

    const loadoutResult = await pool.query("SELECT * FROM loadouts WHERE id = $1", [
      req.params.id,
    ]);
    const loadout = loadoutResult.rows[0];
    if (!loadout) throw new HttpError(404, "Loadout not found");

    const items = await fetchLoadoutItems(req.params.id);
    const resolvedItems = items.map((item) => ({
      ...item,
      resolved_quantity: item.scales_with_crew ? Number(item.quantity) * crewSize : Number(item.quantity),
    }));

    res.json({ loadout, crew_size: crewSize, items: resolvedItems });
  }),
);

// Partial update -- same shape as PATCH /crew-members/:id and /sites/:id.
loadoutsRouter.patch(
  "/loadouts/:id",
  asyncHandler(async (req, res) => {
    const { name, job_type_id } = req.body;
    const result = await pool.query(
      `UPDATE loadouts SET name = COALESCE($2, name), job_type_id = COALESCE($3, job_type_id)
       WHERE id = $1
       RETURNING *`,
      [req.params.id, name ?? null, job_type_id ?? null],
    );
    if (!result.rows[0]) throw new HttpError(404, "Loadout not found");
    res.json(result.rows[0]);
  }),
);

// loadout_items cascade automatically (ON DELETE CASCADE on loadout_id).
loadoutsRouter.delete(
  "/loadouts/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM loadouts WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, "Loadout not found");
    res.status(204).end();
  }),
);

loadoutsRouter.post(
  "/loadouts/:id/items",
  asyncHandler(async (req, res) => {
    const loadout = await pool.query("SELECT id FROM loadouts WHERE id = $1", [req.params.id]);
    if (!loadout.rows[0]) throw new HttpError(404, "Loadout not found");

    const item = validateItem(req.body);
    const result = await pool.query(
      `INSERT INTO loadout_items (loadout_id, asset_id, consumable_id, quantity, scales_with_crew)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, item.asset_id ?? null, item.consumable_id ?? null, item.quantity, item.scales_with_crew ?? false],
    );
    res.status(201).json(result.rows[0]);
  }),
);

// What an item points to (asset vs consumable) is fixed at creation --
// changing that is delete-and-recreate, not an edit. Only quantity and
// scales_with_crew are mutable here.
loadoutsRouter.patch(
  "/loadout-items/:id",
  asyncHandler(async (req, res) => {
    const { quantity, scales_with_crew } = req.body;
    if (quantity !== undefined && (typeof quantity !== "number" || quantity <= 0)) {
      throw new HttpError(400, "quantity must be a positive number");
    }
    const result = await pool.query(
      `UPDATE loadout_items
       SET quantity = COALESCE($2, quantity), scales_with_crew = COALESCE($3, scales_with_crew)
       WHERE id = $1
       RETURNING *`,
      [req.params.id, quantity ?? null, scales_with_crew ?? null],
    );
    if (!result.rows[0]) throw new HttpError(404, "Loadout item not found");
    res.json(result.rows[0]);
  }),
);

loadoutsRouter.delete(
  "/loadout-items/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM loadout_items WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, "Loadout item not found");
    res.status(204).end();
  }),
);
