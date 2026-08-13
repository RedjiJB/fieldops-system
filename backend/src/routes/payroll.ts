import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { requireAdmin } from "../lib/roles.js";

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
      params.push(date_to);
      conditions.push(`po.paid_at <= $${params.length}`);
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
