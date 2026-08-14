import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { hashPassword } from "../lib/password.js";
import { requireAdmin, requireDashboardUser } from "../lib/roles.js";

export const usersRouter = Router();

const MIN_PASSWORD_LENGTH = 8;
// owner is admin-equivalent-or-greater everywhere requireAdmin is checked
// (see lib/roles.ts) -- see 0049_users_role_owner.sql.
const USER_ROLES = ["admin", "staff", "owner"] as const;

usersRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    requireDashboardUser(req);
    const result = await pool.query("SELECT id, email, name, role, active, created_at FROM users ORDER BY name");
    res.json(result.rows);
  }),
);

usersRouter.post(
  "/users",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) throw new HttpError(400, "name, email, and password are required");
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (role !== undefined && !USER_ROLES.includes(role)) {
      throw new HttpError(400, `role must be one of: ${USER_ROLES.join(", ")}`);
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, active, created_at`,
      [name, email, passwordHash, role ?? "staff"],
    );
    res.status(201).json(result.rows[0]);
  }),
);

// Partial update -- same shape as every other PATCH this session, admin-only
// for every field including self-edits (deliberately simple first pass; no
// "edit your own name" exception). No email re-verification step exists
// yet, so changing email here takes effect immediately for the next login.
usersRouter.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const auth = requireAdmin(req);
    const { name, email, active, role } = req.body;
    if (active === false && auth.userId === req.params.id) {
      throw new HttpError(400, "You can't deactivate your own account");
    }
    if (role !== undefined && !USER_ROLES.includes(role)) {
      throw new HttpError(400, `role must be one of: ${USER_ROLES.join(", ")}`);
    }

    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($2, name), email = COALESCE($3, email), active = COALESCE($4, active), role = COALESCE($5, role)
       WHERE id = $1
       RETURNING id, email, name, role, active, created_at`,
      [req.params.id, name ?? null, email ?? null, active ?? null, role ?? null],
    );
    if (!result.rows[0]) throw new HttpError(404, "User not found");
    res.json(result.rows[0]);
  }),
);

// No current-password re-verification -- admin-only now closes the gap the
// old placeholder comment here used to flag ("reset my own" vs "reset
// someone else's" needed role tiering to distinguish; it now exists).
usersRouter.patch(
  "/users/:id/password",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { new_password } = req.body;
    if (!new_password || new_password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, `new_password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const passwordHash = await hashPassword(new_password);
    const result = await pool.query(
      `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id, email, name, role, active, created_at`,
      [req.params.id, passwordHash],
    );
    if (!result.rows[0]) throw new HttpError(404, "User not found");
    res.json(result.rows[0]);
  }),
);
