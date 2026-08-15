import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const crewMembersRouter = Router();

// Matches the role comment on crew_members in DATABASE_SCHEMA.md. role is
// plain TEXT in the DB (not a Postgres enum), so this is enforced here.
// foreman replaced crew_lead (0048_crew_role_foreman_owner.sql) -- pure
// rename, it never gated anything. owner is admin-equivalent-or-greater
// everywhere requireAdmin is checked (see lib/roles.ts) and joins
// management on the confirmation-approval gate (see confirmations.ts).
const CREW_ROLES = ["crew", "foreman", "yard", "management", "owner"] as const;

// Agent-facing only (see 0058_crew_preferred_language.sql) -- doesn't
// translate the dashboard UI or system-generated notification templates.
// Ottawa is bilingual; en/fr covers the actual backlog ask. Plain TEXT in
// the DB, same reasoning as CREW_ROLES above -- enforced here, not a
// Postgres enum, since this is small and app-layer validation is already
// the established pattern for exactly this kind of field on this table.
const PREFERRED_LANGUAGES = ["en", "fr"] as const;

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

// Partial update -- only fields present in the body change. No dashboard
// page existed before this that needed to edit a crew member at all
// (assign/register was always the whole operation).
crewMembersRouter.patch(
  "/crew-members/:id",
  asyncHandler(async (req, res) => {
    const { name, role, active, preferred_language } = req.body;
    if (role !== undefined && !CREW_ROLES.includes(role)) {
      throw new HttpError(400, `role must be one of: ${CREW_ROLES.join(", ")}`);
    }
    if (preferred_language !== undefined && preferred_language !== null && !PREFERRED_LANGUAGES.includes(preferred_language)) {
      throw new HttpError(400, `preferred_language must be one of: ${PREFERRED_LANGUAGES.join(", ")}, or null`);
    }

    // Same COALESCE-only convention as name/role/active above -- none of
    // this route's fields support an explicit clear-to-null today.
    const result = await pool.query(
      `UPDATE crew_members
       SET name = COALESCE($2, name), role = COALESCE($3, role), active = COALESCE($4, active),
           preferred_language = COALESCE($5, preferred_language)
       WHERE id = $1
       RETURNING *`,
      [req.params.id, name ?? null, role ?? null, active ?? null, preferred_language ?? null],
    );
    if (!result.rows[0]) throw new HttpError(404, "Crew member not found");
    res.json(result.rows[0]);
  }),
);
