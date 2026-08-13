import type { Request } from "express";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { hashPassword } from "../lib/password.js";

export const usersRouter = Router();

const MIN_PASSWORD_LENGTH = 8;

// Dashboard account management is for dashboard users, not the WhatsApp
// agent -- the service token has no business here.
function requireDashboardUser(req: Request) {
  if (req.auth?.type !== "user") throw new HttpError(403, "Only a dashboard user can manage accounts");
  return req.auth;
}

usersRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    requireDashboardUser(req);
    const result = await pool.query("SELECT id, email, name, active, created_at FROM users ORDER BY name");
    res.json(result.rows);
  }),
);

usersRouter.post(
  "/users",
  asyncHandler(async (req, res) => {
    requireDashboardUser(req);
    const { name, email, password } = req.body;
    if (!name || !email || !password) throw new HttpError(400, "name, email, and password are required");
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, email, name, active, created_at`,
      [name, email, passwordHash],
    );
    res.status(201).json(result.rows[0]);
  }),
);

// Partial update -- same shape as every other PATCH this session. No email
// re-verification step exists yet, so changing email here takes effect
// immediately for the next login.
usersRouter.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const auth = requireDashboardUser(req);
    const { name, email, active } = req.body;
    if (active === false && auth.userId === req.params.id) {
      throw new HttpError(400, "You can't deactivate your own account");
    }

    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($2, name), email = COALESCE($3, email), active = COALESCE($4, active)
       WHERE id = $1
       RETURNING id, email, name, active, created_at`,
      [req.params.id, name ?? null, email ?? null, active ?? null],
    );
    if (!result.rows[0]) throw new HttpError(404, "User not found");
    res.json(result.rows[0]);
  }),
);

// No current-password re-verification -- there's no role/permission tiering
// yet to distinguish "reset my own" from "reset someone else's" (see
// ARCHITECTURE.md's users notes); this is a placeholder until that exists.
usersRouter.patch(
  "/users/:id/password",
  asyncHandler(async (req, res) => {
    requireDashboardUser(req);
    const { new_password } = req.body;
    if (!new_password || new_password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, `new_password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const passwordHash = await hashPassword(new_password);
    const result = await pool.query(
      `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id, email, name, active, created_at`,
      [req.params.id, passwordHash],
    );
    if (!result.rows[0]) throw new HttpError(404, "User not found");
    res.json(result.rows[0]);
  }),
);
