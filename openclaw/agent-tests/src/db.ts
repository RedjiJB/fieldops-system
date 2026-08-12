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
