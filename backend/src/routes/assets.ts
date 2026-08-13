import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { insertNotification } from "../lib/notify.js";

// Only 'missing'/'retired' are genuine exceptions worth an instant push to
// management -- everything else (registration, verification, maintenance)
// is routine and only ever shows up in the digest via list_notifications.
const CRITICAL_ASSET_STATUSES = new Set(["missing", "retired"]);

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
      conditions.push(`a.status = $${params.length}`);
    }
    if (site_id) {
      params.push(site_id);
      conditions.push(`a.current_site_id = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`a.category = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    // Joined names for the dashboard's asset browser — raw UUIDs aren't
    // useful on a management screen. Purely additive, same reasoning as
    // GET /orders/GET /shifts gaining joined names earlier.
    const result = await pool.query(
      `SELECT a.*, s.name AS current_site_name, cm.name AS current_holder_name
       FROM assets a
       LEFT JOIN sites s ON s.id = a.current_site_id
       LEFT JOIN crew_members cm ON cm.id = a.current_holder
       ${where}
       ORDER BY a.created_at DESC`,
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
    const asset = result.rows[0];
    await insertNotification(
      pool,
      "routine",
      `New tool registered: ${asset.name} (${asset.category}) — pending verification.`,
      "asset",
      asset.id,
    );
    res.status(201).json(asset);
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
    const asset = result.rows[0];
    if (!asset) throw new HttpError(404, "Asset not found");
    await insertNotification(pool, "routine", `${asset.name} verified — now available.`, "asset", asset.id);
    res.json(asset);
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
      `UPDATE assets a SET status = $2 WHERE a.id = $1
       RETURNING a.*,
         (SELECT name FROM sites WHERE id = a.current_site_id) AS current_site_name,
         (SELECT name FROM crew_members WHERE id = a.current_holder) AS current_holder_name`,
      [req.params.id, status],
    );
    const asset = result.rows[0];
    if (!asset) throw new HttpError(404, "Asset not found");

    const location = asset.current_holder_name
      ? ` — last held by ${asset.current_holder_name}${asset.current_site_name ? ` at ${asset.current_site_name}` : ""}`
      : asset.current_site_name
        ? ` — last at ${asset.current_site_name}`
        : "";
    const statusMessage: Record<string, string> = {
      missing: `🚨 ${asset.name} marked MISSING${location}.`,
      retired: `${asset.name} retired — removed from active inventory${location}.`,
      checked_out: `${asset.name} checked out${location}.`,
      in_maintenance: `${asset.name} sent to maintenance${location}.`,
      unconfirmed: `${asset.name} status reset to unconfirmed.`,
    };
    await insertNotification(
      pool,
      CRITICAL_ASSET_STATUSES.has(status) ? "critical" : "routine",
      statusMessage[status] ?? `${asset.name} status changed to ${status}.`,
      "asset",
      asset.id,
    );

    delete asset.current_site_name;
    delete asset.current_holder_name;
    res.json(asset);
  }),
);
