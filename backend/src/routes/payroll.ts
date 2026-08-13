import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { requireAdmin } from "../lib/roles.js";
import { fetchSessionsInRange } from "../lib/timeclock.js";

export const payrollRouter = Router();

const PAY_TYPES = ["payroll", "cash"] as const;

payrollRouter.get(
  "/crew-members/pay-profiles",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const result = await pool.query(
      `SELECT cm.id AS crew_member_id, cm.name AS crew_member_name,
              COALESCE(p.pay_type, 'payroll') AS pay_type, p.hourly_rate, p.updated_at
       FROM crew_members cm
       LEFT JOIN crew_pay_profiles p ON p.crew_member_id = cm.id
       ORDER BY cm.name`,
    );
    res.json(result.rows);
  }),
);

payrollRouter.patch(
  "/crew-members/:id/pay-profile",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { pay_type, hourly_rate } = req.body;
    if (pay_type !== undefined && !PAY_TYPES.includes(pay_type)) {
      throw new HttpError(400, `pay_type must be one of: ${PAY_TYPES.join(", ")}`);
    }
    if (hourly_rate !== undefined && hourly_rate !== null && hourly_rate < 0) {
      throw new HttpError(400, "hourly_rate cannot be negative");
    }

    const crewResult = await pool.query("SELECT id FROM crew_members WHERE id = $1", [req.params.id]);
    if (!crewResult.rows[0]) throw new HttpError(404, "Crew member not found");

    const result = await pool.query(
      `INSERT INTO crew_pay_profiles (crew_member_id, pay_type, hourly_rate, updated_at)
       VALUES ($1, COALESCE($2, 'payroll'), $3, now())
       ON CONFLICT (crew_member_id) DO UPDATE
         SET pay_type = COALESCE($2, crew_pay_profiles.pay_type),
             hourly_rate = COALESCE($3, crew_pay_profiles.hourly_rate),
             updated_at = now()
       RETURNING crew_member_id, pay_type, hourly_rate, updated_at`,
      [req.params.id, pay_type ?? null, hourly_rate ?? null],
    );
    res.json(result.rows[0]);
  }),
);

payrollRouter.post(
  "/payouts",
  asyncHandler(async (req, res) => {
    const auth = requireAdmin(req);
    const { crew_member_id, amount, paid_at, note } = req.body;
    if (!crew_member_id || amount === undefined) {
      throw new HttpError(400, "crew_member_id and amount are required");
    }
    if (amount <= 0) throw new HttpError(400, "amount must be greater than 0");

    const result = await pool.query(
      `INSERT INTO payouts (crew_member_id, amount, paid_at, note, recorded_by_user_id)
       VALUES ($1, $2, COALESCE($3, now()), $4, $5)
       RETURNING *`,
      [crew_member_id, amount, paid_at ?? null, note ?? null, auth.userId],
    );
    res.status(201).json(result.rows[0]);
  }),
);

payrollRouter.get(
  "/payouts",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { crew_member_id, date_from, date_to } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (crew_member_id) {
      params.push(crew_member_id);
      conditions.push(`po.crew_member_id = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conditions.push(`po.paid_at >= $${params.length}`);
    }
    if (date_to) {
      // Inclusive of the whole date_to day -- a bare date string compared
      // with <= truncates to midnight, silently excluding same-day payouts
      // recorded later than 00:00.
      params.push(date_to);
      conditions.push(`po.paid_at < ($${params.length}::date + interval '1 day')`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT po.*, cm.name AS crew_member_name, u.name AS recorded_by_name
       FROM payouts po
       JOIN crew_members cm ON cm.id = po.crew_member_id
       JOIN users u ON u.id = po.recorded_by_user_id
       ${where}
       ORDER BY po.paid_at DESC`,
      params,
    );
    res.json(result.rows);
  }),
);

payrollRouter.get(
  "/payroll/reconciliation",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { crew_member_id, date_from, date_to } = req.query;

    const sessions = await fetchSessionsInRange(pool, {
      crew_member_id: crew_member_id as string | undefined,
      date_from: date_from as string | undefined,
      date_to: date_to as string | undefined,
    });

    // Completed hours only -- an incomplete session's net_seconds is null
    // and never folded into the total as if it were 0 or fully worked; it's
    // counted separately instead so the gap stays visible.
    const hoursByCrewMember = new Map<string, { completedSeconds: number; incompleteCount: number }>();
    for (const s of sessions) {
      const entry = hoursByCrewMember.get(s.crew_member_id) ?? { completedSeconds: 0, incompleteCount: 0 };
      if (s.incomplete) {
        entry.incompleteCount += 1;
      } else {
        entry.completedSeconds += s.net_seconds ?? 0;
      }
      hoursByCrewMember.set(s.crew_member_id, entry);
    }

    // Payouts use the exact requested range -- a payout is a point in time,
    // not a span, so it doesn't need the padded-then-trimmed treatment
    // sessions do.
    const payoutConditions: string[] = [];
    const payoutParams: unknown[] = [];
    if (crew_member_id) {
      payoutParams.push(crew_member_id);
      payoutConditions.push(`crew_member_id = $${payoutParams.length}`);
    }
    if (date_from) {
      payoutParams.push(date_from);
      payoutConditions.push(`paid_at >= $${payoutParams.length}`);
    }
    if (date_to) {
      // Same inclusive-of-day fix as GET /payouts above.
      payoutParams.push(date_to);
      payoutConditions.push(`paid_at < ($${payoutParams.length}::date + interval '1 day')`);
    }
    const payoutWhere = payoutConditions.length ? `WHERE ${payoutConditions.join(" AND ")}` : "";
    const payoutsResult = await pool.query(
      `SELECT crew_member_id, SUM(amount) AS total_paid FROM payouts ${payoutWhere} GROUP BY crew_member_id`,
      payoutParams,
    );
    const paidByCrewMember = new Map<string, number>(
      payoutsResult.rows.map((r) => [r.crew_member_id, Number(r.total_paid)]),
    );

    const profilesResult = await pool.query(
      `SELECT cm.id AS crew_member_id, cm.name AS crew_member_name,
              COALESCE(p.pay_type, 'payroll') AS pay_type, p.hourly_rate
       FROM crew_members cm
       LEFT JOIN crew_pay_profiles p ON p.crew_member_id = cm.id`,
    );
    const profileByCrewMember = new Map(profilesResult.rows.map((r) => [r.crew_member_id, r]));

    // Only crew members with activity in range -- a table full of all-zero
    // rows for everyone else isn't useful.
    const crewIds = new Set([...hoursByCrewMember.keys(), ...paidByCrewMember.keys()]);

    const rows = [...crewIds].map((id) => {
      const hours = hoursByCrewMember.get(id) ?? { completedSeconds: 0, incompleteCount: 0 };
      const profile = profileByCrewMember.get(id);
      const hourlyRate = profile?.hourly_rate == null ? null : Number(profile.hourly_rate);
      const completedHours = hours.completedSeconds / 3600;
      const amountPaid = paidByCrewMember.get(id) ?? 0;
      // Never computed as if a missing rate were 0 -- "no rate set" is a
      // distinct, honest state from "$0 owed".
      const amountOwed = hourlyRate === null ? null : completedHours * hourlyRate;
      const difference = amountOwed === null ? null : amountOwed - amountPaid;

      return {
        crew_member_id: id,
        crew_member_name: profile?.crew_member_name ?? id,
        pay_type: profile?.pay_type ?? "payroll",
        hourly_rate: hourlyRate,
        completed_hours: completedHours,
        incomplete_sessions: hours.incompleteCount,
        amount_owed: amountOwed,
        amount_paid: amountPaid,
        difference,
      };
    });

    rows.sort((a, b) => a.crew_member_name.localeCompare(b.crew_member_name));
    res.json(rows);
  }),
);
