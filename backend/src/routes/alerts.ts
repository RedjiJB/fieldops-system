import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const alertsRouter = Router();

alertsRouter.get(
  "/alerts",
  asyncHandler(async (req, res) => {
    const { resolved } = req.query;
    let where = "";
    if (resolved === "false") where = "WHERE resolved_at IS NULL";
    else if (resolved === "true") where = "WHERE resolved_at IS NOT NULL";

    const result = await pool.query(`SELECT * FROM alerts ${where} ORDER BY raised_at DESC`);
    res.json(result.rows);
  }),
);

alertsRouter.patch(
  "/alerts/:id/resolve",
  asyncHandler(async (req, res) => {
    const existing = await pool.query("SELECT * FROM alerts WHERE id = $1", [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, "Alert not found");
    if (existing.rows[0].resolved_at) throw new HttpError(400, "Alert already resolved");

    // Who resolved it comes from the auth context, not a client-supplied
    // value — a dashboard user has no crew_members row, so it can't use the
    // agent's resolved_by (crew) path. The agent keeps passing resolved_by
    // in the body exactly as before; a dashboard session never needs to.
    if (req.auth?.type === "user") {
      const result = await pool.query(
        `UPDATE alerts SET resolved_at = now(), resolved_by_user_id = $2 WHERE id = $1 RETURNING *`,
        [req.params.id, req.auth.userId],
      );
      res.json(result.rows[0]);
      return;
    }

    const { resolved_by } = req.body;
    if (!resolved_by) throw new HttpError(400, "resolved_by is required");
    const result = await pool.query(
      `UPDATE alerts SET resolved_at = now(), resolved_by = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, resolved_by],
    );
    res.json(result.rows[0]);
  }),
);
