// Direct Postgres access for fixture setup/teardown — faster than an HTTP
// round-trip, matches backend/src/lib's own convention of plain pool.query.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

// Repo root .env (openclaw/agent-tests/src -> openclaw/agent-tests -> openclaw -> repo root).
const rootEnvPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env");
dotenv.config({ path: rootEnvPath });

// This script runs on the Pi host (like `openclaw` itself), not inside the
// Docker network, so it connects via the published localhost port, not the
// "postgres" service hostname the backend container uses.
const connectionString = `postgres://fieldops:${process.env.POSTGRES_PASSWORD}@127.0.0.1:5432/fieldops`;

export const pool = new Pool({ connectionString });

export async function createCrewMember(name: string, phone: string, role = "crew"): Promise<string> {
  const result = await pool.query(
    "INSERT INTO crew_members (name, phone, role) VALUES ($1, $2, $3) RETURNING id",
    [name, phone, role],
  );
  return result.rows[0].id;
}

export async function createSite(name: string, type = "job_site"): Promise<string> {
  const result = await pool.query("INSERT INTO sites (name, type) VALUES ($1, $2) RETURNING id", [name, type]);
  return result.rows[0].id;
}

export async function createVehicle(plate: string, assignedCrewId?: string): Promise<string> {
  const result = await pool.query(
    "INSERT INTO vehicles (plate, assigned_crew_id) VALUES ($1, $2) RETURNING id",
    [plate, assignedCrewId ?? null],
  );
  return result.rows[0].id;
}

export async function createAsset(
  name: string,
  category: string,
  qrTagId: string,
  status = "unconfirmed",
): Promise<string> {
  const result = await pool.query(
    "INSERT INTO assets (name, category, qr_tag_id, status) VALUES ($1, $2, $3, $4) RETURNING id",
    [name, category, qrTagId, status],
  );
  return result.rows[0].id;
}

export async function deleteById(table: string, id: string): Promise<void> {
  // Table name is always a fixed literal from this file's own callers, never
  // user input — safe to interpolate.
  await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

export async function findVehicleByPlate(plate: string): Promise<{ id: string } | null> {
  const result = await pool.query("SELECT id FROM vehicles WHERE plate = $1", [plate]);
  return result.rows[0] ?? null;
}

export async function shiftExists(crewMemberId: string, siteId: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM shifts WHERE crew_member_id = $1 AND site_id = $2",
    [crewMemberId, siteId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function shiftsForCrewMember(crewMemberId: string): Promise<{ id: string; start_time: string | null }[]> {
  const result = await pool.query(
    "SELECT id, start_time FROM shifts WHERE crew_member_id = $1 ORDER BY created_at DESC",
    [crewMemberId],
  );
  return result.rows;
}

export async function createShift(
  crewMemberId: string,
  siteId: string,
  date: string,
  status = "assigned",
): Promise<string> {
  const result = await pool.query(
    "INSERT INTO shifts (crew_member_id, site_id, date, status) VALUES ($1, $2, $3, $4) RETURNING id",
    [crewMemberId, siteId, date, status],
  );
  return result.rows[0].id;
}

export async function getShiftStatus(shiftId: string): Promise<string | null> {
  const result = await pool.query("SELECT status FROM shifts WHERE id = $1", [shiftId]);
  return result.rows[0]?.status ?? null;
}

// priority/delivered mirror a real pushed critical notification --
// acknowledgment resolution (AGENTS.md's "Acknowledging critical
// notifications") only considers delivered_at IS NOT NULL rows meaningful,
// same filter deliver-notifications.mjs itself uses for escalation.
export async function createNotification(
  message: string,
  priority: "critical" | "routine" = "critical",
  delivered = true,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO notifications (priority, message, source_type, source_id, delivered_at)
     VALUES ($1, $2, 'test', NULL, $3)
     RETURNING id`,
    [priority, message, delivered ? new Date() : null],
  );
  return result.rows[0].id;
}

export async function getNotificationAck(
  notificationId: string,
): Promise<{ acknowledged_at: Date | null; acknowledged_by: string | null }> {
  const result = await pool.query(
    "SELECT acknowledged_at, acknowledged_by FROM notifications WHERE id = $1",
    [notificationId],
  );
  return result.rows[0];
}

// This suite runs against the real live Pi, not an isolated test database
// (see the README) -- a genuine unrelated critical alert can legitimately
// be open at the same time a scenario runs. Scenarios that depend on
// "exactly one open critical" (the acknowledge-single-open-critical
// heuristic itself, per AGENTS.md) need to know that going in, so a real
// alert existing produces a clear skip/diagnostic rather than a confusing
// tool-mismatch failure that looks like a regression but isn't one.
export async function countOpenCriticalNotifications(): Promise<number> {
  const result = await pool.query(
    "SELECT count(*) FROM notifications WHERE priority = 'critical' AND acknowledged_at IS NULL",
  );
  return Number(result.rows[0].count);
}

export async function vehicleTelemetryExists(vehicleId: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM vehicle_telemetry WHERE vehicle_id = $1", [vehicleId]);
  return (result.rowCount ?? 0) > 0;
}

export async function deleteShiftsForCrewMember(crewMemberId: string): Promise<void> {
  await pool.query("DELETE FROM shifts WHERE crew_member_id = $1", [crewMemberId]);
}

export async function deleteVehicleTelemetry(vehicleId: string): Promise<void> {
  await pool.query("DELETE FROM vehicle_telemetry WHERE vehicle_id = $1", [vehicleId]);
}

// The agent can route a crew member's request through any of the two-party
// pilot tools (verify_asset, log_timeclock_event, etc.) depending on how it
// interprets the message -- not always the tool a scenario expects. Any
// scenario involving a test crew member should call this before deleting
// them, regardless of what the scenario itself intended to exercise, or
// cleanup can hit pending_confirmations_crew_member_id_fkey unpredictably.
export async function deletePendingConfirmationsForCrewMember(crewMemberId: string): Promise<void> {
  await pool.query(
    `DELETE FROM notifications WHERE id IN (
       SELECT notification_id FROM pending_confirmations WHERE crew_member_id = $1 AND notification_id IS NOT NULL
     )`,
    [crewMemberId],
  );
  await pool.query("DELETE FROM pending_confirmations WHERE crew_member_id = $1", [crewMemberId]);
}

export async function crewTelemetryExists(crewMemberId: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM crew_telemetry WHERE crew_member_id = $1", [crewMemberId]);
  return (result.rowCount ?? 0) > 0;
}

export async function deleteCrewTelemetry(crewMemberId: string): Promise<void> {
  await pool.query("DELETE FROM crew_telemetry WHERE crew_member_id = $1", [crewMemberId]);
}
