import type { Request } from "express";
import { HttpError } from "./httpError.js";

// Shared by every dashboard-only, role-gated route (users.ts, payroll.ts).
// A single copy so a fix to the gate can't drift out of sync between files.
export function requireDashboardUser(req: Request) {
  if (req.auth?.type !== "user") throw new HttpError(403, "Only a dashboard user can do this");
  return req.auth;
}

// owner is admin-equivalent-or-greater everywhere this is checked -- the
// real business owner should never have less dashboard access than a
// hired admin. Widening this one function propagates to every
// requireAdmin-gated route with no per-route edits needed.
export function requireAdmin(req: Request) {
  const auth = requireDashboardUser(req);
  if (auth.role !== "admin" && auth.role !== "owner") throw new HttpError(403, "Only an admin or owner can do this");
  return auth;
}
