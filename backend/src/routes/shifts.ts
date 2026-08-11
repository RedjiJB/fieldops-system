import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const shiftsRouter = Router();

const TIMECLOCK_EVENTS = ["in", "break_start", "break_end", "out"] as const;

// What event can legally follow a crew member's last recorded event —
// e.g. you can't log a break without having clocked in first.
const LEGAL_NEXT_EVENTS: Record<string, readonly string[]> = {
  none: ["in"],
  in: ["break_start", "out"],
  break_start: ["break_end"],
  break_end: ["break_start", "out"],
  out: ["in"],
};

shiftsRouter.post(
  "/shifts",
  asyncHandler(async (req, res) => {
    const { crew_member_id, site_id, date, start_time, end_time } = req.body;
    if (!crew_member_id || !site_id || !date) {
      throw new HttpError(400, "crew_member_id, site_id, and date are required");
    }

    const result = await pool.query(
      `INSERT INTO shifts (crew_member_id, site_id, date, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [crew_member_id, site_id, date, start_time ?? null, end_time ?? null],
    );
    res.status(201).json(result.rows[0]);
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

shiftsRouter.get(
  "/shifts",
  asyncHandler(async (req, res) => {
    const { date, site_id } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (date) {
      params.push(date);
      conditions.push(`date = $${params.length}`);
    }
    if (site_id) {
      params.push(site_id);
      conditions.push(`site_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT * FROM shifts ${where} ORDER BY date, start_time`,
      params,
    );
    res.json(result.rows);
  }),
);

shiftsRouter.post(
  "/timeclock",
  asyncHandler(async (req, res) => {
    const { crew_member_id, event_type, site_id, geofence_verified } = req.body;
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

      const result = await client.query(
        `INSERT INTO timeclock_entries (crew_member_id, event_type, site_id, geofence_verified)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [crew_member_id, event_type, site_id ?? null, !!geofence_verified],
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
