import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { fetchSessionsInRange } from "../lib/timeclock.js";

export const meRouter = Router();

// Every route here derives crew_member_id from req.auth.crewMemberId --
// never from a query param or the URL -- so there is no way for one crew
// member to see another's data by editing a request. This is the crew
// dashboard portal's whole reason to exist: scoped, server-side, not a
// frontend filter over an admin-shaped route.
function requireCrewSession(req: import("express").Request): string {
  if (req.auth?.type !== "crew") throw new HttpError(403, "Crew session required");
  return req.auth.crewMemberId;
}

meRouter.get(
  "/me/pay",
  asyncHandler(async (req, res) => {
    const crewMemberId = requireCrewSession(req);
    const profileResult = await pool.query(
      `SELECT COALESCE(pay_type, 'payroll') AS pay_type, hourly_rate, updated_at
       FROM crew_pay_profiles WHERE crew_member_id = $1`,
      [crewMemberId],
    );
    const payoutsResult = await pool.query(
      `SELECT id, amount, paid_at, note FROM payouts WHERE crew_member_id = $1 ORDER BY paid_at DESC`,
      [crewMemberId],
    );
    res.json({ profile: profileResult.rows[0] ?? { pay_type: "payroll", hourly_rate: null, updated_at: null }, payouts: payoutsResult.rows });
  }),
);

meRouter.get(
  "/me/shifts",
  asyncHandler(async (req, res) => {
    const crewMemberId = requireCrewSession(req);
    const { date_from, date_to } = req.query;

    const shiftsResult = await pool.query(
      `SELECT sh.*, s.name AS site_name
       FROM shifts sh
       LEFT JOIN sites s ON s.id = sh.site_id
       WHERE sh.crew_member_id = $1
       ORDER BY sh.date DESC, sh.start_time`,
      [crewMemberId],
    );
    const sessions = await fetchSessionsInRange(pool, {
      crew_member_id: crewMemberId,
      date_from: date_from as string | undefined,
      date_to: date_to as string | undefined,
    });
    res.json({ shifts: shiftsResult.rows, timeclock_sessions: sessions });
  }),
);

meRouter.get(
  "/me/checkouts",
  asyncHandler(async (req, res) => {
    const crewMemberId = requireCrewSession(req);
    const result = await pool.query(
      `SELECT c.*, a.name AS asset_name, a.category AS asset_category
       FROM checkouts c
       JOIN assets a ON a.id = c.asset_id
       WHERE c.checked_out_by = $1
       ORDER BY c.checked_out_at DESC`,
      [crewMemberId],
    );
    res.json(result.rows);
  }),
);

meRouter.get(
  "/me/spend-records",
  asyncHandler(async (req, res) => {
    const crewMemberId = requireCrewSession(req);
    const result = await pool.query(
      `SELECT sr.*, d.filename AS document_filename
       FROM spend_records sr
       LEFT JOIN documents d ON d.id = sr.document_id
       WHERE sr.crew_member_id = $1 OR sr.submitted_by = $1
       ORDER BY sr.occurred_at DESC`,
      [crewMemberId],
    );
    res.json(result.rows);
  }),
);
