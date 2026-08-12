import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const crewMembersRouter = Router();

// Matches the role comment on crew_members in DATABASE_SCHEMA.md. role is
// plain TEXT in the DB (not a Postgres enum), so this is enforced here.
const CREW_ROLES = ["crew", "crew_lead", "yard", "management"] as const;

crewMembersRouter.get(
  "/crew-members",
  asyncHandler(async (req, res) => {
    const { phone, role, active } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (phone) {
      params.push(phone);
      conditions.push(`phone = $${params.length}`);
    }
    if (role) {
      params.push(role);
      conditions.push(`role = $${params.length}`);
    }
    if (active !== undefined) {
      params.push(active === "true");
      conditions.push(`active = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT * FROM crew_members ${where} ORDER BY name`,
      params,
    );
    res.json(result.rows);
  }),
);

crewMembersRouter.get(
  "/crew-members/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("SELECT * FROM crew_members WHERE id = $1", [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, "Crew member not found");
    res.json(result.rows[0]);
  }),
);

crewMembersRouter.post(
  "/crew-members",
  asyncHandler(async (req, res) => {
    const { name, phone, role, active } = req.body;
    if (!name || !phone) throw new HttpError(400, "name and phone are required");
    if (role && !CREW_ROLES.includes(role)) {
      throw new HttpError(400, `role must be one of: ${CREW_ROLES.join(", ")}`);
    }

    const result = await pool.query(
      `INSERT INTO crew_members (name, phone, role, active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, phone, role ?? "crew", active ?? true],
    );
    res.status(201).json(result.rows[0]);
  }),
);
