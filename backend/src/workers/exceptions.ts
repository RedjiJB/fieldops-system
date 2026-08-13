import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { haversineDistanceMeters } from "../lib/geo.js";
import { insertNotification } from "../lib/notify.js";
import { fetchDailyForecast } from "../lib/weather.js";

// wrong_site/overdue/order_stalled/delay/weather/loadout_gap are genuine
// exceptions worth an instant push to management; idle and vehicle_dark are
// explicitly noisier proxies (see their check functions below) -- routine,
// digest-only.
const CRITICAL_ALERT_TYPES = new Set([
  "wrong_site",
  "overdue",
  "order_stalled",
  "delay",
  "weather",
  "loadout_gap",
]);

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
// How late a confirmed shift's start time can pass with no check-in before
// it's flagged -- see checkDelayedArrivals below.
const DELAY_BUFFER_MINUTES = 30;
// Forecast thresholds for a job site with a confirmed shift today -- see
// checkWeather below.
const RAIN_PROBABILITY_THRESHOLD = 70;
const WIND_SPEED_THRESHOLD_KMH = 40;

// 'delay' below is a simpler, honest version of the original design (which
// wanted real travel-time-vs-actual comparison) -- see
// docs/EXCEPTION_HANDLING.md. 'loadout_gap' (checkLoadoutGap below) only
// evaluates loadout_items with an asset_id -- consumables have no
// per-departure "still out" signal the way checkouts gives assets, so a
// consumable line in a loadout isn't something this check can honestly
// evaluate yet.

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
  message?: string,
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
    message ?? ALERT_MESSAGES[type] ?? `Alert raised: ${type}.`,
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

async function checkDelayedArrivals(client: PoolClient): Promise<void> {
  // Simpler than the original design's "actual transit time vs. expected"
  // concept (still not buildable -- no site-to-site duration data exists).
  // This instead catches a confirmed shift whose scheduled start has passed,
  // with no check-in recorded, which is the same real problem ("crew isn't
  // where they're supposed to be, on time") without needing travel-time
  // modeling. Relies on the DB's timezone being set correctly (see
  // 0032_database_timezone.sql) so "now() > sh.date + sh.start_time" means
  // what it looks like it means, not a UTC-vs-local mismatch.
  const result = await client.query(
    `SELECT sh.id AS shift_id, sh.site_id, sh.start_time,
            cm.name AS crew_member_name, s.name AS site_name
     FROM shifts sh
     JOIN crew_members cm ON cm.id = sh.crew_member_id
     JOIN sites s ON s.id = sh.site_id
     WHERE sh.date = CURRENT_DATE AND sh.status = 'confirmed' AND sh.start_time IS NOT NULL
       AND now() > (sh.date + sh.start_time + ($1 || ' minutes')::interval)
       AND NOT EXISTS (
         SELECT 1 FROM timeclock_entries t
         WHERE t.crew_member_id = sh.crew_member_id
           AND t.event_type = 'in'
           AND t.timestamp >= sh.date::timestamp
       )`,
    [DELAY_BUFFER_MINUTES],
  );
  for (const row of result.rows) {
    await raiseAlert(
      client,
      "delay",
      row.site_id,
      row.shift_id,
      `🚨 ${row.crew_member_name} hasn't checked in — shift at ${row.site_name} started at ${row.start_time}.`,
    );
  }
}

async function checkWeather(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT DISTINCT s.id AS site_id, s.name AS site_name, s.center_lat, s.center_lng
    FROM sites s
    JOIN shifts sh ON sh.site_id = s.id AND sh.date = CURRENT_DATE AND sh.status = 'confirmed'
    WHERE s.type = 'job_site' AND s.center_lat IS NOT NULL AND s.center_lng IS NOT NULL
  `);

  for (const row of result.rows) {
    // A weather alert is only ever about today's forecast -- auto-resolve a
    // still-open one from a prior day first, so raiseAlert's normal dedup
    // (any unresolved alert of this type/record) doesn't mistake yesterday's
    // stale flag for today's already being raised.
    await client.query(
      `UPDATE alerts SET resolved_at = now()
       WHERE type = 'weather' AND related_record_id = $1 AND resolved_at IS NULL AND raised_at::date < CURRENT_DATE`,
      [row.site_id],
    );

    // Stop re-checking once today's alert has already been raised for this
    // site -- not a strict once-a-day cache (a clear-forecast site gets
    // re-checked every tick), just avoids redundant calls once we already
    // know and have alerted on today's answer.
    const alreadyRaisedToday = await client.query(
      `SELECT 1 FROM alerts WHERE type = 'weather' AND related_record_id = $1 AND raised_at::date = CURRENT_DATE LIMIT 1`,
      [row.site_id],
    );
    if ((alreadyRaisedToday.rowCount ?? 0) > 0) continue;

    const forecast = await fetchDailyForecast(row.center_lat, row.center_lng);
    if (!forecast) continue;

    if (
      forecast.precipitationProbabilityMax >= RAIN_PROBABILITY_THRESHOLD ||
      forecast.windSpeedMaxKmh >= WIND_SPEED_THRESHOLD_KMH
    ) {
      await raiseAlert(
        client,
        "weather",
        row.site_id,
        row.site_id,
        `🌧️ Weather flag for ${row.site_name} today — ${forecast.precipitationProbabilityMax}% rain chance, up to ${Math.round(forecast.windSpeedMaxKmh)} km/h wind.`,
      );
    }
  }
}

async function checkLoadoutGap(client: PoolClient): Promise<void> {
  // "Underway" reuses checkDelayedArrivals' reasoning: at least one
  // confirmed shift on the job whose start time has passed. Only jobs with
  // a job_type_id (and therefore a possible matching loadout) are relevant.
  const jobsResult = await client.query(`
    SELECT DISTINCT j.id AS job_id, j.site_id, j.job_type_id
    FROM jobs j
    JOIN shifts sh ON sh.job_id = j.id AND sh.status = 'confirmed' AND sh.start_time IS NOT NULL
    WHERE j.date = CURRENT_DATE AND j.status != 'complete' AND j.job_type_id IS NOT NULL
      AND now() > (j.date + sh.start_time)
  `);

  for (const job of jobsResult.rows) {
    // Asset items only -- see the module-level comment above for why
    // consumables aren't evaluated here. "Checked out by any crew member on
    // this job" (not a specific one) since a loadout is shared kit for the
    // whole job, not assigned to one person.
    const missingResult = await client.query(
      `SELECT COALESCE(a.name, 'unknown item') AS item_name
       FROM loadouts l
       JOIN loadout_items li ON li.loadout_id = l.id
       LEFT JOIN assets a ON a.id = li.asset_id
       WHERE l.job_type_id = $1
         AND li.asset_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM checkouts c
           JOIN shifts sh ON sh.crew_member_id = c.checked_out_by
           WHERE sh.job_id = $2
             AND c.asset_id = li.asset_id
             AND c.checked_in_at IS NULL
         )`,
      [job.job_type_id, job.job_id],
    );
    if (missingResult.rows.length === 0) continue;

    const missingNames = missingResult.rows.map((r) => r.item_name).join(", ");
    await raiseAlert(
      client,
      "loadout_gap",
      job.site_id,
      job.job_id,
      `🚨 Loadout gap — not checked out yet: ${missingNames}.`,
    );
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
    await checkDelayedArrivals(client);
    await checkLoadoutGap(client);
    await checkWeather(client);
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
