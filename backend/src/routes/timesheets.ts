import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { computeSessions } from "../lib/timeclock.js";

export const timesheetsRouter = Router();

// Widened past the requested range so a session that started before
// date_from or ends after date_to still pairs correctly -- computeSessions
// needs the full session's events, not just the ones inside the window.
const RANGE_PAD_DAYS = 2;

timesheetsRouter.get(
  "/timesheets/sessions",
  asyncHandler(async (req, res) => {
    const { crew_member_id, date_from, date_to } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (crew_member_id) {
      params.push(crew_member_id);
      conditions.push(`crew_member_id = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conditions.push(`timestamp >= $${params.length}::date - interval '${RANGE_PAD_DAYS} days'`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`timestamp < ($${params.length}::date + interval '${RANGE_PAD_DAYS + 1} days')`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT crew_member_id, event_type, site_id, timestamp, geofence_verified
       FROM timeclock_entries
       ${where}
       ORDER BY crew_member_id, timestamp`,
      params,
    );

    let sessions = computeSessions(result.rows);

    // Sessions were computed from a padded window; now trim to what was
    // actually requested (a session touching the edge stays in if any part
    // of it falls inside the requested range).
    if (date_from) {
      const from = new Date(`${date_from}T00:00:00.000Z`).getTime();
      sessions = sessions.filter((s) => (s.ended_at ? new Date(s.ended_at).getTime() : Infinity) >= from);
    }
    if (date_to) {
      const to = new Date(`${date_to}T23:59:59.999Z`).getTime();
      sessions = sessions.filter((s) => new Date(s.started_at).getTime() <= to);
    }

    res.json(sessions);
  }),
);
