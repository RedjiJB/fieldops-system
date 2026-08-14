import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { requireAdmin } from "../lib/roles.js";

export const spendingRouter = Router();

const INSTRUMENT_TYPES = ["company_card", "petty_cash"] as const;
const SPEND_METHODS = ["cash", "company_card", "personal_reimbursed"] as const;
const SPEND_CATEGORIES = ["material", "fuel", "mileage", "receipt", "other"] as const;

spendingRouter.post(
  "/money-instruments",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { type, label } = req.body;
    if (!INSTRUMENT_TYPES.includes(type)) {
      throw new HttpError(400, `type must be one of: ${INSTRUMENT_TYPES.join(", ")}`);
    }
    if (!label) throw new HttpError(400, "label is required");

    const result = await pool.query(
      `INSERT INTO money_instruments (type, label) VALUES ($1, $2) RETURNING *`,
      [type, label],
    );
    res.status(201).json(result.rows[0]);
  }),
);

spendingRouter.get(
  "/money-instruments",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const result = await pool.query(
      `SELECT mi.*, cm.name AS current_holder_name
       FROM money_instruments mi
       LEFT JOIN money_instrument_custody mic ON mic.instrument_id = mi.id AND mic.ended_at IS NULL
       LEFT JOIN crew_members cm ON cm.id = mic.held_by
       ORDER BY mi.label`,
    );
    res.json(result.rows);
  }),
);

spendingRouter.post(
  "/money-instruments/:id/assign",
  asyncHandler(async (req, res) => {
    const auth = requireAdmin(req);
    const { held_by } = req.body;
    if (!held_by) throw new HttpError(400, "held_by is required");

    const instrumentResult = await pool.query("SELECT id FROM money_instruments WHERE id = $1", [
      req.params.id,
    ]);
    if (!instrumentResult.rows[0]) throw new HttpError(404, "Money instrument not found");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE money_instrument_custody SET ended_at = now() WHERE instrument_id = $1 AND ended_at IS NULL`,
        [req.params.id],
      );
      const custodyResult = await client.query(
        `INSERT INTO money_instrument_custody (instrument_id, held_by, assigned_by_user_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [req.params.id, held_by, auth.userId],
      );
      await client.query("COMMIT");
      res.status(201).json(custodyResult.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

spendingRouter.patch(
  "/money-instruments/:id/balance",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { delta } = req.body;
    if (typeof delta !== "number") throw new HttpError(400, "delta (number) is required");

    const existing = await pool.query("SELECT * FROM money_instruments WHERE id = $1", [req.params.id]);
    const instrument = existing.rows[0];
    if (!instrument) throw new HttpError(404, "Money instrument not found");
    if (instrument.type !== "petty_cash") {
      throw new HttpError(400, "Only petty_cash instruments carry a balance");
    }

    const result = await pool.query(
      `UPDATE money_instruments SET balance = COALESCE(balance, 0) + $2 WHERE id = $1 RETURNING *`,
      [req.params.id, delta],
    );
    res.json(result.rows[0]);
  }),
);

spendingRouter.post(
  "/spend-records",
  asyncHandler(async (req, res) => {
    const auth = requireAdmin(req);
    const {
      category,
      method,
      amount,
      distance_km,
      description,
      document_id,
      instrument_id,
      crew_member_id,
      occurred_at,
    } = req.body;

    if (!SPEND_CATEGORIES.includes(category)) {
      throw new HttpError(400, `category must be one of: ${SPEND_CATEGORIES.join(", ")}`);
    }
    if (!SPEND_METHODS.includes(method)) {
      throw new HttpError(400, `method must be one of: ${SPEND_METHODS.join(", ")}`);
    }

    if (category === "mileage") {
      if (method !== "personal_reimbursed") {
        throw new HttpError(400, "mileage entries must use method personal_reimbursed");
      }
      if (typeof distance_km !== "number" || distance_km <= 0) {
        throw new HttpError(400, "distance_km (positive number) is required for mileage");
      }
      if (amount !== undefined) {
        throw new HttpError(400, "amount is set at approval time for mileage, not at submission");
      }
    } else {
      if (typeof amount !== "number" || amount <= 0) {
        throw new HttpError(400, "amount (positive number) is required");
      }
      if (distance_km !== undefined) {
        throw new HttpError(400, "distance_km only applies to category: mileage");
      }
    }

    // A record of money already spent with a card/float needs no review; a
    // personal reimbursement is a claim that needs sign-off before it's
    // trusted, same "crew claims need independent verification" principle
    // as everywhere else this session.
    const status = method === "personal_reimbursed" ? "pending" : "approved";

    const result = await pool.query(
      `INSERT INTO spend_records
         (category, method, status, amount, distance_km, description, document_id, instrument_id,
          crew_member_id, submitted_by_user_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, now()))
       RETURNING *`,
      [
        category,
        method,
        status,
        category === "mileage" ? null : amount,
        category === "mileage" ? distance_km : null,
        description ?? null,
        document_id ?? null,
        instrument_id ?? null,
        crew_member_id ?? null,
        auth.userId,
        occurred_at ?? null,
      ],
    );
    res.status(201).json(result.rows[0]);
  }),
);

spendingRouter.get(
  "/spend-records",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { category, method, status, crew_member_id, date_from, date_to } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (category) {
      params.push(category);
      conditions.push(`sr.category = $${params.length}`);
    }
    if (method) {
      params.push(method);
      conditions.push(`sr.method = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`sr.status = $${params.length}`);
    }
    if (crew_member_id) {
      params.push(crew_member_id);
      conditions.push(`sr.crew_member_id = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conditions.push(`sr.occurred_at >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`sr.occurred_at < ($${params.length}::date + interval '1 day')`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT sr.*, cm.name AS crew_member_name,
              COALESCE(u1.name, cm1.name) AS submitted_by_name,
              COALESCE(u2.name, cm2.name) AS reviewed_by_name,
              d.filename AS document_filename, mi.label AS instrument_label
       FROM spend_records sr
       LEFT JOIN crew_members cm ON cm.id = sr.crew_member_id
       LEFT JOIN users u1 ON u1.id = sr.submitted_by_user_id
       LEFT JOIN crew_members cm1 ON cm1.id = sr.submitted_by
       LEFT JOIN users u2 ON u2.id = sr.reviewed_by_user_id
       LEFT JOIN crew_members cm2 ON cm2.id = sr.reviewed_by
       LEFT JOIN documents d ON d.id = sr.document_id
       LEFT JOIN money_instruments mi ON mi.id = sr.instrument_id
       ${where}
       ORDER BY sr.occurred_at DESC`,
      params,
    );
    res.json(result.rows);
  }),
);

spendingRouter.patch(
  "/spend-records/:id/approve",
  asyncHandler(async (req, res) => {
    const auth = requireAdmin(req);
    const { rate_per_km } = req.body;

    const existing = await pool.query("SELECT * FROM spend_records WHERE id = $1", [req.params.id]);
    const record = existing.rows[0];
    if (!record) throw new HttpError(404, "Spend record not found");
    if (record.status !== "pending") throw new HttpError(400, "This record has already been reviewed");

    let amount = record.amount;
    if (record.category === "mileage") {
      if (typeof rate_per_km !== "number" || rate_per_km < 0) {
        throw new HttpError(400, "rate_per_km (non-negative number) is required to approve a mileage claim");
      }
      amount = Number(record.distance_km) * rate_per_km;
    }

    const result = await pool.query(
      `UPDATE spend_records
       SET status = 'approved', amount = $2, rate_per_km = $3, reviewed_by_user_id = $4, reviewed_at = now()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, amount, record.category === "mileage" ? rate_per_km : record.rate_per_km, auth.userId],
    );
    res.json(result.rows[0]);
  }),
);

spendingRouter.patch(
  "/spend-records/:id/reject",
  asyncHandler(async (req, res) => {
    const auth = requireAdmin(req);

    const existing = await pool.query("SELECT * FROM spend_records WHERE id = $1", [req.params.id]);
    const record = existing.rows[0];
    if (!record) throw new HttpError(404, "Spend record not found");
    if (record.status !== "pending") throw new HttpError(400, "This record has already been reviewed");

    const result = await pool.query(
      `UPDATE spend_records SET status = 'rejected', reviewed_by_user_id = $2, reviewed_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, auth.userId],
    );
    res.json(result.rows[0]);
  }),
);
