import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const rideRequestsRouter = Router();

const REQUEST_TYPES = ["need_ride", "offering_ride"] as const;

rideRequestsRouter.get(
  "/ride-requests",
  asyncHandler(async (req, res) => {
    const { status, date } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      conditions.push(`rr.status = $${params.length}`);
    }
    if (date) {
      params.push(date);
      conditions.push(`rr.date = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT rr.*, cm.name AS crew_member_name, cm.phone AS crew_member_phone, s.name AS site_name
       FROM ride_requests rr
       JOIN crew_members cm ON cm.id = rr.crew_member_id
       LEFT JOIN sites s ON s.id = rr.site_id
       ${where}
       ORDER BY rr.date, rr.created_at`,
      params,
    );
    res.json(result.rows);
  }),
);

rideRequestsRouter.post(
  "/ride-requests",
  asyncHandler(async (req, res) => {
    const { crew_member_id, request_type, date, site_id, seats_available, notes } = req.body;
    if (!crew_member_id || !REQUEST_TYPES.includes(request_type) || !date) {
      throw new HttpError(400, `crew_member_id, date, and request_type (one of: ${REQUEST_TYPES.join(", ")}) are required`);
    }

    const result = await pool.query(
      `INSERT INTO ride_requests (crew_member_id, request_type, date, site_id, seats_available, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [crew_member_id, request_type, date, site_id ?? null, seats_available ?? null, notes ?? null],
    );
    res.status(201).json(result.rows[0]);
  }),
);

// Sets matched_request_id on both rows in one transaction -- a need and an
// offer are matched as a pair, never one-sided. Row locking mirrors
// confirmations.ts's FOR UPDATE convention for a two-record state change.
rideRequestsRouter.patch(
  "/ride-requests/:id/match",
  asyncHandler(async (req, res) => {
    const { matched_with_id } = req.body;
    if (!matched_with_id) throw new HttpError(400, "matched_with_id is required");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const rows = await client.query(
        "SELECT * FROM ride_requests WHERE id IN ($1, $2) FOR UPDATE",
        [req.params.id, matched_with_id],
      );
      if (rows.rows.length !== 2) throw new HttpError(404, "One or both ride requests not found");
      const a = rows.rows.find((r) => r.id === req.params.id);
      const b = rows.rows.find((r) => r.id === matched_with_id);
      if (a.status !== "open" || b.status !== "open") {
        throw new HttpError(400, "Both ride requests must be open to match");
      }
      if (a.request_type === b.request_type) {
        throw new HttpError(400, "Can only match a 'need_ride' request with an 'offering_ride' request");
      }

      await client.query(
        `UPDATE ride_requests SET status = 'matched', matched_request_id = $2 WHERE id = $1`,
        [a.id, b.id],
      );
      await client.query(
        `UPDATE ride_requests SET status = 'matched', matched_request_id = $2 WHERE id = $1`,
        [b.id, a.id],
      );

      await client.query("COMMIT");
      const updated = await pool.query("SELECT * FROM ride_requests WHERE id IN ($1, $2)", [a.id, b.id]);
      res.json(updated.rows);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

rideRequestsRouter.patch(
  "/ride-requests/:id/cancel",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `UPDATE ride_requests SET status = 'cancelled' WHERE id = $1 AND status != 'cancelled' RETURNING *`,
      [req.params.id],
    );
    if (!result.rows[0]) throw new HttpError(404, "Ride request not found or already cancelled");
    res.json(result.rows[0]);
  }),
);
