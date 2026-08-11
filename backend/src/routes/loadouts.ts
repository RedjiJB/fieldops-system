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

function validateItems(items: unknown): LoadoutItemInput[] {
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

    const itemsResult = await pool.query(
      `SELECT
         li.id, li.asset_id, li.consumable_id, li.quantity, li.scales_with_crew,
         COALESCE(a.name, c.name) AS item_name
       FROM loadout_items li
       LEFT JOIN assets a ON li.asset_id = a.id
       LEFT JOIN consumables c ON li.consumable_id = c.id
       WHERE li.loadout_id = $1
       ORDER BY item_name`,
      [req.params.id],
    );

    const resolvedItems = itemsResult.rows.map((item) => ({
      ...item,
      resolved_quantity: item.scales_with_crew ? Number(item.quantity) * crewSize : Number(item.quantity),
    }));

    res.json({ loadout, crew_size: crewSize, items: resolvedItems });
  }),
);
