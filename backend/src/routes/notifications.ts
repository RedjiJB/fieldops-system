import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const notificationsRouter = Router();

const PRIORITIES = ["critical", "routine"] as const;

// Polled by openclaw/notifier/deliver-notifications.mjs on the Pi host
// every minute -- the only undelivered 'critical' rows, oldest first, so a
// send failure leaves a row for retry on the next poll without re-sending
// anything already delivered.
notificationsRouter.get(
  "/notifications/pending",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT * FROM notifications WHERE priority = 'critical' AND delivered_at IS NULL ORDER BY created_at ASC`,
    );
    res.json(result.rows);
  }),
);

// Used by the digest agent's list_notifications tool to pull routine
// (never-pushed) events for a time window -- defaults to the last 24h.
notificationsRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const { priority, since } = req.query;
    if (priority && !PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
      throw new HttpError(400, `priority must be one of: ${PRIORITIES.join(", ")}`);
    }
    const conditions: string[] = [];
    const params: unknown[] = [];

    conditions.push(`priority = $${params.push((priority as string) ?? "routine")}`);
    conditions.push(`created_at >= $${params.push(since ? new Date(since as string) : new Date(Date.now() - 24 * 60 * 60 * 1000))}`);

    const result = await pool.query(
      `SELECT * FROM notifications WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`,
      params,
    );
    res.json(result.rows);
  }),
);

notificationsRouter.patch(
  "/notifications/:id/delivered",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `UPDATE notifications SET delivered_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!result.rows[0]) throw new HttpError(404, "Notification not found");
    res.json(result.rows[0]);
  }),
);
