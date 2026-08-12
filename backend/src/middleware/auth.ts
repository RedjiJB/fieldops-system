import { parse as parseCookie } from "cookie";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { findSessionUser } from "../lib/session.js";

export const SESSION_COOKIE_NAME = "fieldops_session";

// Accepts either the agent's static service token (Authorization: Bearer)
// or a real dashboard user's session cookie — one guard, two credential
// types, so adding real per-user login never breaks the already-working
// WhatsApp agent integration, which has no concept of logging in.
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const serviceToken = process.env.AGENT_SERVICE_TOKEN;
  if (serviceToken && authHeader === `Bearer ${serviceToken}`) {
    req.auth = { type: "service" };
    next();
    return;
  }

  const cookies = parseCookie(req.headers.cookie ?? "");
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  const user = sessionToken ? await findSessionUser(sessionToken) : null;
  if (!user) throw new HttpError(401, "Authentication required");

  req.auth = { type: "user", userId: user.id, email: user.email, name: user.name };
  next();
});
