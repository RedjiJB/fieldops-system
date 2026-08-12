import { randomBytes, createHash } from "node:crypto";
import { pool } from "../db/pool.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches the login cookie's Max-Age

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    sha256Hex(token),
    userId,
    expiresAt,
  ]);
  return token;
}

export async function findSessionUser(
  token: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const result = await pool.query(
    `SELECT u.id, u.email, u.name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256Hex(token)],
  );
  return result.rows[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256Hex(token)]);
}
