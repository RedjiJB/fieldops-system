import { Router } from "express";
import rateLimit from "express-rate-limit";
import { serialize as serializeCookie, parse as parseCookie } from "cookie";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { verifyPassword } from "../lib/password.js";
import { createSession, deleteSession } from "../lib/session.js";
import { requireAuth, SESSION_COOKIE_NAME } from "../middleware/auth.js";

export const authRouter = Router();

const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days, matches session.ts's SESSION_TTL_MS

// /auth/login is the one endpoint in this API a stranger can hit without
// already having a credential — the classic brute-force target. Everything
// else is already behind requireAuth (a session or the service token), so
// this is the only route that actually needs a rate limit.
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

authRouter.post(
  "/auth/login",
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) throw new HttpError(400, "email and password are required");

    const result = await pool.query("SELECT id, email, name, role, password_hash FROM users WHERE email = $1", [
      email,
    ]);
    const user = result.rows[0];
    // Same error either way — don't reveal whether the email exists.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new HttpError(401, "Invalid email or password");
    }

    const token = await createSession(user.id);
    res.setHeader(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      }),
    );
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  }),
);

authRouter.post(
  "/auth/logout",
  asyncHandler(async (req, res) => {
    const cookies = parseCookie(req.headers.cookie ?? "");
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) await deleteSession(token);

    res.setHeader(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 }),
    );
    res.status(204).end();
  }),
);

authRouter.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== "user") throw new HttpError(401, "Authentication required");
    res.json({ id: req.auth.userId, email: req.auth.email, name: req.auth.name, role: req.auth.role });
  }),
);
