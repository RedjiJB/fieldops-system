import type { PoolClient } from "pg";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { haversineDistanceMeters } from "../lib/geo.js";

export const shiftsRouter = Router();

export const TIMECLOCK_EVENTS = ["in", "break_start", "break_end", "out"] as const;

// Server-derived, never client-asserted -- this replaces the old "trust
// whatever boolean the agent sends" behavior. No site_id, no lat/lng, or a
// site with no geofence configured all fall through to `false`, same
// default as before -- there's just no path left to assert `true` without
// actual coordinates now. Circular geofences only, same limitation as
// exceptions.ts's checkWrongSite (geofence_polygon still isn't checked
// anywhere in this codebase).
export async function resolveGeofenceVerified(
  client: PoolClient,
  siteId: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<boolean> {
  if (!siteId || lat == null || lng == null) return false;
  const result = await client.query(
    "SELECT center_lat, center_lng, geofence_radius_m FROM sites WHERE id = $1",
    [siteId],
  );
  const site = result.rows[0];
  if (!site || site.center_lat == null || site.center_lng == null || site.geofence_radius_m == null) {
    return false;
  }
  return haversineDistanceMeters(lat, lng, site.center_lat, site.center_lng) <= site.geofence_radius_m;
}

// What event can legally follow a crew member's last recorded event —
// e.g. you can't log a break without having clocked in first. Exported for
// confirmations.ts, which re-runs this same check at approval time (state
// may have shifted since a pending confirmation was submitted).
export const LEGAL_NEXT_EVENTS: Record<string, readonly string[]> = {
  none: ["in"],
  in: ["break_start", "out"],
  break_start: ["break_end"],
  break_end: ["break_start", "out"],
  out: ["in"],
};

shiftsRouter.post(
  "/shifts",
  asyncHandler(async (req, res) => {
    const { crew_member_id, site_id, date, start_time, end_time, job_id } = req.body;
    if (!crew_member_id || !site_id || !date) {
      throw new HttpError(400, "crew_member_id, site_id, and date are required");
    }

    const result = await pool.query(
      `INSERT INTO shifts (crew_member_id, site_id, date, start_time, end_time, job_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [crew_member_id, site_id, date, start_time ?? null, end_time ?? null, job_id ?? null],
    );
    res.status(201).json(result.rows[0]);
  }),
);

interface BatchShiftInput {
  crew_member_id: string;
  site_id: string;
  date: string;
  start_time?: string;
  end_time?: string;
  job_id?: string;
}

function validateBatchShifts(shifts: unknown): BatchShiftInput[] {
  if (!Array.isArray(shifts) || shifts.length === 0) {
    throw new HttpError(400, "shifts must be a non-empty array");
  }
  for (const s of shifts) {
    if (!s.crew_member_id || !s.site_id || !s.date) {
      throw new HttpError(400, "each shift needs crew_member_id, site_id, and date");
    }
  }
  return shifts;
}

// For dispatch messages that assign several people to several sites at
// once — the real-world pattern this exists for. All-or-nothing: if any
// one assignment is invalid (e.g. bad crew_member_id), none are created,
// so a partial dispatch never silently happens.
shiftsRouter.post(
  "/shifts/batch",
  asyncHandler(async (req, res) => {
    const validShifts = validateBatchShifts(req.body.shifts);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = [];
      for (const s of validShifts) {
        const result = await client.query(
          `INSERT INTO shifts (crew_member_id, site_id, date, start_time, end_time, job_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [s.crew_member_id, s.site_id, s.date, s.start_time ?? null, s.end_time ?? null, s.job_id ?? null],
        );
        created.push(result.rows[0]);
      }
      await client.query("COMMIT");
      res.status(201).json(created);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

shiftsRouter.patch(
  "/shifts/:id/confirm",
  asyncHandler(async (req, res) => {
    const { decision } = req.body;
    if (decision !== "confirm" && decision !== "decline") {
      throw new HttpError(400, "decision must be 'confirm' or 'decline'");
    }

    const existing = await pool.query("SELECT * FROM shifts WHERE id = $1", [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, "Shift not found");
    if (existing.rows[0].status !== "assigned") {
      throw new HttpError(
        409,
        `Shift already resolved (current status: ${existing.rows[0].status})`,
      );
    }

    const newStatus = decision === "confirm" ? "confirmed" : "declined";
    const result = await pool.query("UPDATE shifts SET status = $2 WHERE id = $1 RETURNING *", [
      req.params.id,
      newStatus,
    ]);
    res.json(result.rows[0]);
  }),
);

const SHIFT_STATUSES = ["assigned", "confirmed", "no_show", "declined"] as const;

shiftsRouter.get(
  "/shifts",
  asyncHandler(async (req, res) => {
    const { date, site_id, crew_member_id, status, job_id } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (date) {
      params.push(date);
      conditions.push(`sh.date = $${params.length}`);
    }
    if (site_id) {
      params.push(site_id);
      conditions.push(`sh.site_id = $${params.length}`);
    }
    if (crew_member_id) {
      params.push(crew_member_id);
      conditions.push(`sh.crew_member_id = $${params.length}`);
    }
    if (job_id) {
      params.push(job_id);
      conditions.push(`sh.job_id = $${params.length}`);
    }
    if (status) {
      if (!SHIFT_STATUSES.includes(status as (typeof SHIFT_STATUSES)[number])) {
        throw new HttpError(400, `status must be one of: ${SHIFT_STATUSES.join(", ")}`);
      }
      params.push(status);
      conditions.push(`sh.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    // Joined names/phone for the dashboard's ops overview and
    // openclaw/notifier/nudge-shifts.mjs (needs a target phone to nudge
    // directly) — same reasoning as GET /orders. Purely additive for the
    // agent's list_shifts tool.
    const result = await pool.query(
      `SELECT sh.*, s.name AS site_name, cm.name AS crew_member_name, cm.phone AS crew_member_phone
       FROM shifts sh
       LEFT JOIN sites s ON s.id = sh.site_id
       LEFT JOIN crew_members cm ON cm.id = sh.crew_member_id
       ${where}
       ORDER BY sh.date, sh.start_time`,
      params,
    );
    res.json(result.rows);
  }),
);

// Set by nudge-shifts.mjs after a successful send, so a same-evening cron
// re-run doesn't double-message the same crew member.
shiftsRouter.patch(
  "/shifts/:id/nudged",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`UPDATE shifts SET nudged_at = now() WHERE id = $1 RETURNING *`, [
      req.params.id,
    ]);
    if (!result.rows[0]) throw new HttpError(404, "Shift not found");
    res.json(result.rows[0]);
  }),
);

// Same idempotency pattern as /nudged above, for shift-reminder.mjs's
// 1-hour-before "starting soon" ping -- a distinct notification from the
// evening-before confirm/decline nudge, so it gets its own column.
shiftsRouter.patch(
  "/shifts/:id/reminder-sent",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`UPDATE shifts SET reminder_sent_at = now() WHERE id = $1 RETURNING *`, [
      req.params.id,
    ]);
    if (!result.rows[0]) throw new HttpError(404, "Shift not found");
    res.json(result.rows[0]);
  }),
);

shiftsRouter.post(
  "/timeclock",
  asyncHandler(async (req, res) => {
    const { crew_member_id, event_type, site_id, lat, lng } = req.body;
    if (!crew_member_id || !TIMECLOCK_EVENTS.includes(event_type)) {
      throw new HttpError(
        400,
        `crew_member_id is required and event_type must be one of: ${TIMECLOCK_EVENTS.join(", ")}`,
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const lastResult = await client.query(
        `SELECT event_type FROM timeclock_entries
         WHERE crew_member_id = $1
         ORDER BY timestamp DESC
         LIMIT 1
         FOR UPDATE`,
        [crew_member_id],
      );
      const lastEvent = lastResult.rows[0]?.event_type ?? "none";
      const allowedNext = LEGAL_NEXT_EVENTS[lastEvent] ?? [];
      if (!allowedNext.includes(event_type)) {
        throw new HttpError(
          409,
          `Cannot log '${event_type}' — last event was '${lastEvent}'. Expected one of: ${allowedNext.join(", ")}`,
        );
      }

      const geofenceVerified = await resolveGeofenceVerified(client, site_id, lat, lng);
      const result = await client.query(
        `INSERT INTO timeclock_entries (crew_member_id, event_type, site_id, geofence_verified)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [crew_member_id, event_type, site_id ?? null, geofenceVerified],
      );

      await client.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

shiftsRouter.get(
  "/crew/status",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(`
      SELECT
        cm.id, cm.name, cm.role,
        t.event_type AS last_event_type,
        t.site_id AS last_site_id,
        t.timestamp AS last_event_at,
        t.geofence_verified
      FROM crew_members cm
      LEFT JOIN LATERAL (
        SELECT event_type, site_id, timestamp, geofence_verified
        FROM timeclock_entries
        WHERE crew_member_id = cm.id
        ORDER BY timestamp DESC
        LIMIT 1
      ) t ON true
      WHERE cm.active = true
      ORDER BY cm.name
    `);
    res.json(result.rows);
  }),
);
