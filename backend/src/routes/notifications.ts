import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { insertNotification } from "../lib/notify.js";

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

// Used by the digest agent's list_notifications tool (routine events) and
// the dashboard activity feed (both priorities, when priority is omitted --
// the only existing caller always passes priority=routine explicitly, so
// this change is additive, not a behavior change for anything already live).
notificationsRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const { priority, since, acknowledged, whatsapp_message_id } = req.query;
    if (priority && !PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
      throw new HttpError(400, `priority must be one of: ${PRIORITIES.join(", ")}`);
    }
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (priority) conditions.push(`priority = $${params.push(priority)}`);
    conditions.push(
      `created_at >= $${params.push(since ? new Date(since as string) : new Date(Date.now() - 24 * 60 * 60 * 1000))}`,
    );
    if (acknowledged === "false") conditions.push(`acknowledged_at IS NULL`);
    else if (acknowledged === "true") conditions.push(`acknowledged_at IS NOT NULL`);
    if (whatsapp_message_id) conditions.push(`whatsapp_message_id = $${params.push(whatsapp_message_id)}`);

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
    const { whatsapp_message_id } = req.body ?? {};
    const result = await pool.query(
      `UPDATE notifications
       SET delivered_at = now(), whatsapp_message_id = COALESCE($2, whatsapp_message_id)
       WHERE id = $1 RETURNING *`,
      [req.params.id, whatsapp_message_id ?? null],
    );
    if (!result.rows[0]) throw new HttpError(404, "Notification not found");
    res.json(result.rows[0]);
  }),
);

// Acknowledgment ("a human has seen this and is on it") is deliberately
// separate from alerts.resolved_at ("the problem is actually fixed") --
// see AGENTS.md's "Acknowledging critical notifications". Dual auth path
// mirrors alerts.ts's /resolve exactly.
notificationsRouter.patch(
  "/notifications/:id/acknowledge",
  asyncHandler(async (req, res) => {
    const existing = await pool.query("SELECT * FROM notifications WHERE id = $1", [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, "Notification not found");
    if (existing.rows[0].acknowledged_at) throw new HttpError(400, "Notification already acknowledged");

    if (req.auth?.type === "user") {
      const result = await pool.query(
        `UPDATE notifications SET acknowledged_at = now(), acknowledged_by_user_id = $2 WHERE id = $1 RETURNING *`,
        [req.params.id, req.auth.userId],
      );
      res.json(result.rows[0]);
      return;
    }

    const { acknowledged_by } = req.body;
    if (!acknowledged_by) throw new HttpError(400, "acknowledged_by is required");
    const result = await pool.query(
      `UPDATE notifications SET acknowledged_at = now(), acknowledged_by = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, acknowledged_by],
    );
    res.json(result.rows[0]);
  }),
);

// Exported for exceptions.ts's expirePendingConfirmations, which reuses
// this exact threshold rather than duplicating it.
export const ESCALATION_THRESHOLD_MINUTES = 20;
export const MAX_ESCALATIONS = 3;

// Polled by the same deliver-notifications.mjs run, right after the
// first-push pass -- critical, delivered, still unacknowledged, and either
// never escalated or last escalated long enough ago, capped so a genuinely
// unreachable recipient doesn't get spammed forever.
notificationsRouter.get(
  "/notifications/escalation-candidates",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE priority = 'critical' AND delivered_at IS NOT NULL AND acknowledged_at IS NULL
         AND escalated_count < $1
         AND COALESCE(last_escalated_at, delivered_at) < now() - ($2 || ' minutes')::interval
       ORDER BY created_at ASC`,
      [MAX_ESCALATIONS, ESCALATION_THRESHOLD_MINUTES],
    );
    res.json(result.rows);
  }),
);

notificationsRouter.patch(
  "/notifications/:id/escalate",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `UPDATE notifications SET escalated_count = escalated_count + 1, last_escalated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!result.rows[0]) throw new HttpError(404, "Notification not found");
    res.json(result.rows[0]);
  }),
);

// The one place a notification is authored directly from a conversation
// rather than derived from backend state -- every other notification comes
// from a route/worker observing a real data change. Always critical: there's
// no ambiguity to weigh for a safety report the way there is for, say, an
// idle-crew flag. See AGENTS.md's "Safety and emergencies".
notificationsRouter.post(
  "/notifications/safety-report",
  asyncHandler(async (req, res) => {
    const { message, crew_member_id } = req.body;
    if (!message) throw new HttpError(400, "message is required");
    await insertNotification(pool, "critical", `🚨 SAFETY: ${message}`, "safety_report", crew_member_id ?? null);
    res.status(201).json({ ok: true });
  }),
);
