import { randomBytes, createHash } from "node:crypto";
import { pool } from "../db/pool.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches the login cookie's Max-Age
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes -- bounds the interception window, not the resulting session's
// A fresh link every time someone asks, but not on demand faster than this --
// keeps a crew member from being able to spam-generate WhatsApp messages
// (each request sends one) or from a repeated ask silently invalidating a
// link the person hasn't tapped yet.
const LOGIN_TOKEN_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export class LoginTokenCooldownError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`A login link was already sent recently -- try again in ${retryAfterSeconds}s`);
  }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function createSession(identity: { userId: string } | { crewMemberId: string }): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, crew_member_id, expires_at) VALUES ($1, $2, $3, $4)",
    [
      sha256Hex(token),
      "userId" in identity ? identity.userId : null,
      "crewMemberId" in identity ? identity.crewMemberId : null,
      expiresAt,
    ],
  );
  return token;
}

export type SessionIdentity =
  | { type: "user"; id: string; email: string; name: string; role: string }
  | { type: "crew"; id: string; name: string; role: string };

// Renamed from findSessionUser -- now resolves either identity type a
// session can carry. middleware/auth.ts is the only caller.
export async function findSessionIdentity(token: string): Promise<SessionIdentity | null> {
  const result = await pool.query(
    `SELECT s.user_id, s.crew_member_id,
            u.email AS u_email, u.name AS u_name, u.role AS u_role,
            cm.name AS cm_name, cm.role AS cm_role
     FROM sessions s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN crew_members cm ON cm.id = s.crew_member_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256Hex(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return row.user_id
    ? { type: "user", id: row.user_id, email: row.u_email, name: row.u_name, role: row.u_role }
    : { type: "crew", id: row.crew_member_id, name: row.cm_name, role: row.cm_role };
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256Hex(token)]);
}

// Throws LoginTokenCooldownError (never silently reuses or silently
// refuses) if this crew member already has a token issued within the
// cooldown window -- checked against created_at regardless of whether that
// earlier token was ever redeemed, so the cooldown can't be bypassed by
// tapping the old link first.
export async function createLoginToken(crewMemberId: string): Promise<string> {
  const recent = await pool.query(
    `SELECT created_at FROM login_tokens
     WHERE crew_member_id = $1 AND created_at > now() - make_interval(secs => $2)
     ORDER BY created_at DESC LIMIT 1`,
    [crewMemberId, LOGIN_TOKEN_COOLDOWN_MS / 1000],
  );
  const lastIssuedAt: Date | undefined = recent.rows[0]?.created_at;
  if (lastIssuedAt) {
    const elapsedMs = Date.now() - lastIssuedAt.getTime();
    const retryAfterSeconds = Math.ceil((LOGIN_TOKEN_COOLDOWN_MS - elapsedMs) / 1000);
    if (retryAfterSeconds > 0) throw new LoginTokenCooldownError(retryAfterSeconds);
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_MS);
  await pool.query("INSERT INTO login_tokens (token_hash, crew_member_id, expires_at) VALUES ($1, $2, $3)", [
    sha256Hex(token),
    crewMemberId,
    expiresAt,
  ]);
  return token;
}

// Single-use: the UPDATE only matches a row that hasn't been used yet, so a
// replayed token (already redeemed, or expired) returns null rather than
// silently minting a second session.
export async function redeemLoginToken(token: string): Promise<string | null> {
  const result = await pool.query(
    `UPDATE login_tokens SET used_at = now()
     WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL
     RETURNING crew_member_id`,
    [sha256Hex(token)],
  );
  return result.rows[0]?.crew_member_id ?? null;
}
