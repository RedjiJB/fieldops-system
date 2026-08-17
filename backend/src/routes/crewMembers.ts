import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { metersBetween, reverseGeocode } from "../lib/geocode.js";

const TELEMETRY_SOURCES = ["whatsapp_location", "obd"] as const;
const GEOCODE_REUSE_RADIUS_METERS = 100;

export const crewMembersRouter = Router();

// Matches the role comment on crew_members in DATABASE_SCHEMA.md. role is
// plain TEXT in the DB (not a Postgres enum), so this is enforced here.
// foreman replaced crew_lead (0048_crew_role_foreman_owner.sql) -- pure
// rename, it never gated anything. owner is admin-equivalent-or-greater
// everywhere requireAdmin is checked (see lib/roles.ts) and joins
// management on the confirmation-approval gate (see confirmations.ts).
// IT added 2026-08-16 for the system operator's own crew_members row --
// deliberately distinct from management so notification_settings'
// it_escalation_roles can target IT-type alerts (backend/connectivity/disk
// issues) at this person specifically, without also being swept into every
// broader management-tier operational broadcast that isn't relevant to
// running the system itself. Doesn't affect dashboard access (that's
// users.role, a separate table/axis) -- this only governs WhatsApp-side
// crew-tier notification routing and crew-portal display.
const CREW_ROLES = ["crew", "foreman", "yard", "management", "owner", "IT"] as const;

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

// Person-level counterpart to POST /vehicles/:id/telemetry -- same
// reverse-geocode-reuse-within-100m logic, same source enum, deliberately
// identical shape so a WhatsApp location share can be logged here even for
// a crew member with no assigned vehicle (or riding as a carpool
// passenger), which had no location path at all before this.
crewMembersRouter.post(
  "/crew-members/:id/telemetry",
  asyncHandler(async (req, res) => {
    const { lat, lng, source } = req.body;
    if (typeof lat !== "number" || typeof lng !== "number") {
      throw new HttpError(400, "lat and lng (numbers) are required");
    }
    if (source && !TELEMETRY_SOURCES.includes(source)) {
      throw new HttpError(400, `source must be one of: ${TELEMETRY_SOURCES.join(", ")}`);
    }

    const crewMember = await pool.query("SELECT id FROM crew_members WHERE id = $1", [req.params.id]);
    if (!crewMember.rows[0]) throw new HttpError(404, "Crew member not found");

    const lastPoint = await pool.query(
      "SELECT lat, lng, address FROM crew_telemetry WHERE crew_member_id = $1 ORDER BY timestamp DESC LIMIT 1",
      [req.params.id],
    );
    const last = lastPoint.rows[0] as { lat: number; lng: number; address: string | null } | undefined;

    let address: string | null;
    if (last?.address && metersBetween(lat, lng, last.lat, last.lng) < GEOCODE_REUSE_RADIUS_METERS) {
      address = last.address;
    } else {
      address = await reverseGeocode(lat, lng);
    }

    const result = await pool.query(
      `INSERT INTO crew_telemetry (crew_member_id, lat, lng, source, address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, lat, lng, source ?? "whatsapp_location", address],
    );
    res.status(201).json(result.rows[0]);
  }),
);

crewMembersRouter.get(
  "/crew-members/:id/telemetry",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM crew_telemetry WHERE crew_member_id = $1 ORDER BY timestamp DESC LIMIT 1",
      [req.params.id],
    );
    res.json(result.rows[0] ?? null);
  }),
);
