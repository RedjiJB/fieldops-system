import type { Request } from "express";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { raiseAlert } from "../workers/exceptions.js";

export const systemRouter = Router();

function requireServiceToken(req: Request) {
  if (req.auth?.type !== "service") {
    throw new HttpError(403, "Only the agent service token can do this");
  }
}

systemRouter.get(
  "/system/dashboard-url",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT url, reachable, checked_at, updated_at, last_restarted_at FROM dashboard_url LIMIT 1",
    );
    res.json(result.rows[0]);
  }),
);

systemRouter.patch(
  "/system/dashboard-url",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { url } = req.body;
    if (!url) throw new HttpError(400, "url is required");
    await pool.query("UPDATE dashboard_url SET url = $1, updated_at = now()", [url]);
    res.json({ ok: true });
  }),
);

// Drives the dashboard_unreachable alert -- reuses the exceptions worker's
// own raiseAlert (same dedup-while-unresolved semantics as every other
// exception check) rather than a separate alerting path. Never
// auto-resolves on recovery, same convention as the rest of that worker --
// a human confirms via the Alerts page.
//
// {restarted: true} is optional and set ONLY by restart_dashboard_tunnel's
// own post-restart sync invocation, never by the routine 5-minute cron
// poll -- checked_at gets touched on every call regardless, so it can't
// tell "just health-checked" from "just restarted" apart. last_restarted_at
// is the field that actually answers that question.
systemRouter.post(
  "/system/dashboard-url/health",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { reachable, restarted } = req.body;
    if (typeof reachable !== "boolean") throw new HttpError(400, "reachable (boolean) is required");

    const result = await pool.query(
      `UPDATE dashboard_url
       SET reachable = $1, checked_at = now(), last_restarted_at = CASE WHEN $2 THEN now() ELSE last_restarted_at END
       RETURNING id`,
      [reachable, restarted === true],
    );
    const row = result.rows[0];

    if (!reachable) {
      const client = await pool.connect();
      try {
        await raiseAlert(client, "dashboard_unreachable", null, row.id);
      } finally {
        client.release();
      }
    }
    res.json({ ok: true });
  }),
);

systemRouter.get(
  "/system/backup-status",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT id, last_attempt_at, last_success_at, last_size_bytes, last_error FROM backup_status LIMIT 1",
    );
    res.json(result.rows[0]);
  }),
);

// Reported by openclaw/notifier/backup-database.mjs after every nightly
// pg_dump attempt. Explicit failure raises immediately here, same as
// dashboard-url/health above; staleness (the cron job silently not running
// at all) is instead caught by the exceptions worker's checkBackupStale,
// since nothing calls this route to say so -- there's no negative signal
// for "didn't run."
systemRouter.post(
  "/system/backup-status",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { success, sizeBytes, error } = req.body;
    if (typeof success !== "boolean") throw new HttpError(400, "success (boolean) is required");

    const result = await pool.query(
      `UPDATE backup_status
       SET last_attempt_at = now(),
           last_success_at = CASE WHEN $1 THEN now() ELSE last_success_at END,
           last_size_bytes = CASE WHEN $1 THEN $2 ELSE last_size_bytes END,
           last_error = CASE WHEN $1 THEN NULL ELSE $3 END
       RETURNING id`,
      [success, sizeBytes ?? null, error ?? null],
    );
    const row = result.rows[0];

    if (!success) {
      const client = await pool.connect();
      try {
        await raiseAlert(
          client,
          "backup_failed",
          null,
          row.id,
          `🚨 Nightly database backup failed${error ? `: ${error}` : "."}`,
        );
      } finally {
        client.release();
      }
    }
    res.json({ ok: true });
  }),
);
