import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { haversineDistanceMeters } from "../lib/geo.js";
import { insertNotification } from "../lib/notify.js";

// wrong_site/overdue/order_stalled are genuine exceptions worth an instant
// push to management; idle is explicitly a "rough proxy" prone to false
// positives (see checkIdleCrew below) -- routine, digest-only.
const CRITICAL_ALERT_TYPES = new Set(["wrong_site", "overdue", "order_stalled"]);

const ALERT_MESSAGES: Record<string, string> = {
  overdue: "🚨 A checked-out asset is overdue for return.",
  order_stalled: "🚨 An order has been sitting unconfirmed for over 24 hours.",
  wrong_site: "🚨 A vehicle is outside its expected site's geofence.",
  idle: "A crew member has been on-shift 2+ hours with no recorded site activity.",
  vehicle_dark: "A vehicle was reporting location today and has since gone quiet for 3+ hours.",
};

// Orders sitting in 'requested' longer than this without advancing get flagged.
const ORDER_STALL_HOURS = 24;
// Crew clocked in (or back from break) longer than this with no site
// activity gets flagged as idle.
const IDLE_HOURS = 2;
// Vehicle telemetry older than this is treated as stale, not evidence of
// a current wrong-site arrival.
const STALE_TELEMETRY_MINUTES = 60;
// Telemetry is WhatsApp-share-driven and historically sparse (6 shares
// across 10 weeks of real chat history) -- 3h of silence only means
// something if the vehicle was actually reporting earlier that same shift,
// not for a vehicle that simply never shares. See checkVehicleDark below.
const VEHICLE_DARK_HOURS = 3;

// NOTE: 'delay' and 'loadout_gap' alert types are intentionally not raised
// yet. 'delay' would need an "expected travel time" concept that doesn't
// exist anywhere in the schema. 'loadout_gap' would need a link from a
// shift to a job type/loadout, which doesn't exist either — see the
// documents.job_id comment in DATABASE_SCHEMA.md, which already flags a
// "jobs" concept as deferred rather than something to improvise around here.

async function alertAlreadyOpen(
  client: PoolClient,
  type: string,
  relatedRecordId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM alerts WHERE type = $1 AND related_record_id = $2 AND resolved_at IS NULL LIMIT 1`,
    [type, relatedRecordId],
  );
  return (result.rowCount ?? 0) > 0;
}

async function raiseAlert(
  client: PoolClient,
  type: string,
  siteId: string | null,
  relatedRecordId: string,
): Promise<void> {
  if (await alertAlreadyOpen(client, type, relatedRecordId)) return;
  await client.query(`INSERT INTO alerts (type, site_id, related_record_id) VALUES ($1, $2, $3)`, [
    type,
    siteId,
    relatedRecordId,
  ]);
  await insertNotification(
    client,
    CRITICAL_ALERT_TYPES.has(type) ? "critical" : "routine",
    ALERT_MESSAGES[type] ?? `Alert raised: ${type}.`,
    "alert",
    relatedRecordId,
  );
}

async function checkOverdueCheckouts(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT c.id, a.current_site_id
    FROM checkouts c
    JOIN assets a ON a.id = c.asset_id
    WHERE c.checked_in_at IS NULL
      AND c.expected_return_at IS NOT NULL
      AND c.expected_return_at < now()
  `);
  for (const row of result.rows) {
    await raiseAlert(client, "overdue", row.current_site_id, row.id);
  }
}

async function checkStalledOrders(client: PoolClient): Promise<void> {
  const result = await client.query(
    `SELECT id, site_id FROM orders
     WHERE status = 'requested' AND created_at < now() - ($1 || ' hours')::interval`,
    [ORDER_STALL_HOURS],
  );
  for (const row of result.rows) {
    await raiseAlert(client, "order_stalled", row.site_id, row.id);
  }
}

async function checkIdleCrew(client: PoolClient): Promise<void> {
  // Crew members currently on-shift (last event 'in' or 'break_end'), with
  // no order or checkout activity recorded at their site since they last
  // clocked in — a rough proxy for "nothing is moving" until a real
  // task/job concept exists to check against directly.
  const onShift = await client.query(`
    SELECT DISTINCT ON (cm.id)
      cm.id AS crew_member_id, t.site_id, t.timestamp, t.event_type
    FROM crew_members cm
    JOIN timeclock_entries t ON t.crew_member_id = cm.id
    WHERE cm.active = true
    ORDER BY cm.id, t.timestamp DESC
  `);

  for (const row of onShift.rows) {
    if (!["in", "break_end"].includes(row.event_type)) continue;
    if (!row.site_id) continue;

    const hoursSince = (Date.now() - new Date(row.timestamp).getTime()) / (1000 * 60 * 60);
    if (hoursSince < IDLE_HOURS) continue;

    const activity = await client.query(
      `SELECT
         EXISTS(SELECT 1 FROM orders WHERE site_id = $1 AND created_at > $2) AS has_order,
         EXISTS(
           SELECT 1 FROM checkouts c JOIN assets a ON a.id = c.asset_id
           WHERE a.current_site_id = $1 AND c.checked_out_at > $2
         ) AS has_checkout`,
      [row.site_id, row.timestamp],
    );
    if (!activity.rows[0].has_order && !activity.rows[0].has_checkout) {
      await raiseAlert(client, "idle", row.site_id, row.crew_member_id);
    }
  }
}

async function checkWrongSite(client: PoolClient): Promise<void> {
  // Only circular geofences (geofence_radius_m) are checked — polygon
  // geofences (larger commercial sites, per ARCHITECTURE.md) would need
  // point-in-polygon logic not implemented here yet.
  const result = await client.query(`
    SELECT
      v.id AS vehicle_id,
      s.id AS site_id, s.center_lat, s.center_lng, s.geofence_radius_m,
      vt.lat, vt.lng, vt.timestamp AS telemetry_at
    FROM vehicles v
    JOIN shifts sh ON sh.crew_member_id = v.assigned_crew_id
      AND sh.date = CURRENT_DATE AND sh.status = 'confirmed'
    JOIN sites s ON s.id = sh.site_id
    LEFT JOIN LATERAL (
      SELECT lat, lng, timestamp FROM vehicle_telemetry
      WHERE vehicle_id = v.id
      ORDER BY timestamp DESC
      LIMIT 1
    ) vt ON true
    WHERE v.assigned_crew_id IS NOT NULL
  `);

  for (const row of result.rows) {
    if (row.lat == null || row.lng == null || !row.telemetry_at) continue;
    if (row.center_lat == null || row.center_lng == null || row.geofence_radius_m == null) continue;

    const ageMinutes = (Date.now() - new Date(row.telemetry_at).getTime()) / (1000 * 60);
    if (ageMinutes > STALE_TELEMETRY_MINUTES) continue;

    const distance = haversineDistanceMeters(row.lat, row.lng, row.center_lat, row.center_lng);
    if (distance > row.geofence_radius_m) {
      await raiseAlert(client, "wrong_site", row.site_id, row.vehicle_id);
    }
  }
}

async function checkVehicleDark(client: PoolClient): Promise<void> {
  // Only fires when the vehicle's latest telemetry point is stale AND an
  // earlier point exists within the preceding 24h -- "was reporting, now
  // silent", not "never reports" (see VEHICLE_DARK_HOURS comment above).
  // A vehicle with zero telemetry ever is correctly excluded by the JOIN
  // LATERAL requiring at least one point to exist.
  const result = await client.query(
    `SELECT v.id AS vehicle_id, sh.site_id
     FROM vehicles v
     JOIN shifts sh ON sh.crew_member_id = v.assigned_crew_id
       AND sh.date = CURRENT_DATE AND sh.status = 'confirmed'
     JOIN LATERAL (
       SELECT timestamp FROM vehicle_telemetry
       WHERE vehicle_id = v.id
       ORDER BY timestamp DESC
       LIMIT 1
     ) latest ON true
     WHERE v.assigned_crew_id IS NOT NULL
       AND latest.timestamp < now() - ($1 || ' hours')::interval
       AND EXISTS (
         -- Rolling 24h window, not "same calendar day" -- sh.date::timestamptz
         -- compares against UTC midnight regardless of the crew's actual
         -- timezone, which broke this check every evening once local time
         -- crossed into UTC's next day (caught via live testing on the Pi).
         SELECT 1 FROM vehicle_telemetry vt
         WHERE vt.vehicle_id = v.id
           AND vt.timestamp < latest.timestamp
           AND vt.timestamp >= latest.timestamp - interval '24 hours'
       )`,
    [VEHICLE_DARK_HOURS],
  );
  for (const row of result.rows) {
    await raiseAlert(client, "vehicle_dark", row.site_id, row.vehicle_id);
  }
}

export async function runExceptionChecks(): Promise<void> {
  const client = await pool.connect();
  try {
    await checkOverdueCheckouts(client);
    await checkStalledOrders(client);
    await checkIdleCrew(client);
    await checkWrongSite(client);
    await checkVehicleDark(client);
  } finally {
    client.release();
  }
}

export function startExceptionsWorker(intervalMs: number): ReturnType<typeof setInterval> {
  runExceptionChecks().catch((err) => console.error("Exceptions worker run failed:", err));
  return setInterval(() => {
    runExceptionChecks().catch((err) => console.error("Exceptions worker run failed:", err));
  }, intervalMs);
}
