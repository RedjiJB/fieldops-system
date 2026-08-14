import { parse as parseCookie } from "cookie";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { findSessionIdentity } from "../lib/session.js";

export const SESSION_COOKIE_NAME = "fieldops_session";

// Accepts the agent's static service token (Authorization: Bearer), a real
// dashboard user's session cookie, or (as of the crew-dashboard-access
// increment) a crew member's magic-link session cookie -- same cookie name,
// same table, findSessionIdentity discriminates which one it is. requireAdmin/
// requireDashboardUser (lib/roles.ts) only ever match type === "user", so a
// crew session is automatically blocked from every existing admin-tier
// route with no changes needed there.
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
  const identity = sessionToken ? await findSessionIdentity(sessionToken) : null;
  if (!identity) throw new HttpError(401, "Authentication required");

  req.auth =
    identity.type === "user"
      ? { type: "user", userId: identity.id, email: identity.email, name: identity.name, role: identity.role }
      : { type: "crew", crewMemberId: identity.id, name: identity.name, role: identity.role };
  next();
});
