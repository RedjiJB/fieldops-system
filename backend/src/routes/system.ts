import type { Request } from "express";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { getNotificationSettings } from "../lib/notificationSettings.js";
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

// Reported by openclaw/notifier/sync-model-usage.mjs, which recomputes the
// full aggregate itself from the .jsonl session transcripts on the Pi host
// (the backend has no access to those files) -- this route is a dumb
// UPSERT sink, all the aggregation logic lives in the script, same division
// of responsibility as backup-database.mjs above.
// connectivity_degraded and disk_space_low have no natural backing table
// the way dashboard_url/backup_status do -- there's nothing to point
// related_record_id at. Rather than add a single-row status table purely
// to hold an id (which raiseAlert needs for its open-alert dedup), each
// check uses a fixed sentinel UUID as its own "identity" -- stable across
// every heartbeat.mjs tick for the life of one ongoing condition, so
// raiseAlert's existing "already open?" check naturally prevents a new
// alert every 2 minutes while the problem persists. Resolving the alert
// (same resolve_alert path as everything else) lets the next occurrence
// raise fresh, same behavior any other alert type gets from a real row id.
const CONNECTIVITY_CHECK_ID = "00000000-0000-0000-0000-000000000001";
const DISK_CHECK_ID = "00000000-0000-0000-0000-000000000002";

systemRouter.post(
  "/system/connectivity-health",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { reachable } = req.body;
    if (typeof reachable !== "boolean") throw new HttpError(400, "reachable (boolean) is required");

    if (!reachable) {
      const settings = await getNotificationSettings(pool);
      const client = await pool.connect();
      try {
        await raiseAlert(
          client,
          "connectivity_degraded",
          null,
          CONNECTIVITY_CHECK_ID,
          undefined,
          undefined,
          settings.it_escalation_roles,
        );
      } finally {
        client.release();
      }
    }
    res.json({ ok: true });
  }),
);

systemRouter.post(
  "/system/disk-health",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { low, availableGb } = req.body;
    if (typeof low !== "boolean") throw new HttpError(400, "low (boolean) is required");

    if (low) {
      const settings = await getNotificationSettings(pool);
      const client = await pool.connect();
      try {
        await raiseAlert(
          client,
          "disk_space_low",
          null,
          DISK_CHECK_ID,
          typeof availableGb === "number" ? `🚨 The Pi is running low on disk space (${availableGb.toFixed(1)} GB free).` : undefined,
          undefined,
          settings.it_escalation_roles,
        );
      } finally {
        client.release();
      }
    }
    res.json({ ok: true });
  }),
);

// Backend/Postgres being down is the one failure heartbeat.mjs can't ever
// report live -- if the backend can't be reached, it obviously can't be
// POSTed to. Instead heartbeat.mjs messages IT directly over WhatsApp the
// moment it detects that (bypassing this backend, see the script's own
// comments) and calls this route once afterward, purely to backfill a
// historical record with both timestamps already known -- the only place
// in this codebase an alert's raised_at isn't "now".
systemRouter.post(
  "/system/offline-recovery",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { outageStartedAt, outageEndedAt } = req.body;
    if (!outageStartedAt || !outageEndedAt) {
      throw new HttpError(400, "outageStartedAt and outageEndedAt are required");
    }
    await pool.query(
      `INSERT INTO alerts (type, site_id, related_record_id, raised_at, resolved_at)
       VALUES ('system_offline', NULL, NULL, $1, $2)`,
      [outageStartedAt, outageEndedAt],
    );
    res.json({ ok: true });
  }),
);

// Crew-initiated, via the report_it_issue agent tool (same {message,
// crew_member_id} shape as report_safety_incident) -- but goes through
// raiseAlert/alerts rather than bypassing it, since an IT issue benefits
// from being resolvable/trackable through resolve_alert like every other
// alert type, unlike a one-off safety report. related_record_id stays
// null (a freeform report has no backing record, and alerts.related_
// record_id means "the thing this alert is about," not "who reported
// it" -- reusing it for the reporter would also wrongly dedup a second,
// unrelated report from the same crew member against the first still-open
// one). crew_member_id is resolved to a name here and folded into the
// message text instead, so a human reading the WhatsApp alert knows who
// to call back without a second lookup.
systemRouter.post(
  "/system/it-issue",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { message, crew_member_id } = req.body;
    if (!message) throw new HttpError(400, "message is required");

    let reporterName: string | null = null;
    if (crew_member_id) {
      const result = await pool.query("SELECT name FROM crew_members WHERE id = $1", [crew_member_id]);
      reporterName = result.rows[0]?.name ?? null;
    }

    const settings = await getNotificationSettings(pool);
    const client = await pool.connect();
    try {
      await raiseAlert(
        client,
        "it_issue",
        null,
        null,
        `🚨 IT issue reported${reporterName ? ` by ${reporterName}` : ""}: ${message}`,
        undefined,
        settings.it_escalation_roles,
      );
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }),
);

systemRouter.post(
  "/system/model-usage",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { rows } = req.body;
    if (!Array.isArray(rows)) throw new HttpError(400, "rows (array) is required");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of rows) {
        const {
          date,
          provider,
          model,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_write_tokens,
          reasoning_tokens,
          total_tokens,
          cost_usd,
        } = row;
        if (!date || !provider || !model) {
          throw new HttpError(400, "each row requires date, provider, model");
        }
        await client.query(
          `INSERT INTO model_usage_daily
             (date, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens, cost_usd)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (date, provider, model) DO UPDATE SET
             input_tokens = EXCLUDED.input_tokens,
             output_tokens = EXCLUDED.output_tokens,
             cache_read_tokens = EXCLUDED.cache_read_tokens,
             cache_write_tokens = EXCLUDED.cache_write_tokens,
             reasoning_tokens = EXCLUDED.reasoning_tokens,
             total_tokens = EXCLUDED.total_tokens,
             cost_usd = EXCLUDED.cost_usd`,
          [
            date,
            provider,
            model,
            input_tokens ?? 0,
            output_tokens ?? 0,
            cache_read_tokens ?? 0,
            cache_write_tokens ?? 0,
            reasoning_tokens ?? 0,
            total_tokens ?? 0,
            cost_usd ?? 0,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true, rowsUpserted: rows.length });
  }),
);
