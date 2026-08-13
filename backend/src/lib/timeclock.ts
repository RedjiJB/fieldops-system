import type { Pool, PoolClient } from "pg";

export type TimeclockEventType = "in" | "break_start" | "break_end" | "out";

export type TimeclockEntryRow = {
  crew_member_id: string;
  event_type: TimeclockEventType;
  site_id: string | null;
  timestamp: string | Date;
  geofence_verified: boolean;
};

export type TimeclockSession = {
  crew_member_id: string;
  started_at: string;
  ended_at: string | null; // null means incomplete -- no matching 'out' found
  break_seconds: number;
  net_seconds: number | null; // null means incomplete, never a guessed number
  site_ids: string[];
  geofence_verified: boolean; // every constituent event was geofence-verified
  incomplete: boolean;
};

function toMs(t: string | Date): number {
  return t instanceof Date ? t.getTime() : new Date(t).getTime();
}

// Walks the same legal-transition state machine shifts.ts already enforces
// at write time (in -> (break_start -> break_end)* -> out, out -> in legal
// again) and reduces raw events into sessions. A dangling in/break_start
// with no following out comes back flagged incomplete rather than guessing
// a close time -- this mirrors the session's "crew claims need verification,
// not silent acceptance" principle: an unclosed session is a real gap, not
// something to paper over with an estimate.
export function computeSessions(rows: TimeclockEntryRow[]): TimeclockSession[] {
  const byCrew = new Map<string, TimeclockEntryRow[]>();
  for (const row of rows) {
    const list = byCrew.get(row.crew_member_id) ?? [];
    list.push(row);
    byCrew.set(row.crew_member_id, list);
  }

  const sessions: TimeclockSession[] = [];

  for (const [crewMemberId, events] of byCrew) {
    const sorted = [...events].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

    let state: "none" | "in" | "on_break" = "none";
    let startedAt = 0;
    let breakSeconds = 0;
    let pendingBreakStart = 0;
    let siteIds: string[] = [];
    let geofenceVerified = true;

    function addSite(siteId: string | null) {
      if (siteId && !siteIds.includes(siteId)) siteIds.push(siteId);
    }

    function pushSession(endedAtMs: number | null) {
      sessions.push({
        crew_member_id: crewMemberId,
        started_at: new Date(startedAt).toISOString(),
        ended_at: endedAtMs === null ? null : new Date(endedAtMs).toISOString(),
        break_seconds: breakSeconds,
        net_seconds: endedAtMs === null ? null : (endedAtMs - startedAt) / 1000 - breakSeconds,
        site_ids: siteIds,
        geofence_verified: geofenceVerified,
        incomplete: endedAtMs === null,
      });
    }

    for (const event of sorted) {
      const ts = toMs(event.timestamp);
      if (state === "none") {
        if (event.event_type !== "in") continue; // defensive -- write-time state machine already prevents this
        state = "in";
        startedAt = ts;
        breakSeconds = 0;
        siteIds = [];
        geofenceVerified = true;
        addSite(event.site_id);
        geofenceVerified &&= event.geofence_verified;
      } else if (state === "in") {
        if (event.event_type === "break_start") {
          state = "on_break";
          pendingBreakStart = ts;
          addSite(event.site_id);
          geofenceVerified &&= event.geofence_verified;
        } else if (event.event_type === "out") {
          addSite(event.site_id);
          geofenceVerified &&= event.geofence_verified;
          pushSession(ts);
          state = "none";
        }
      } else if (state === "on_break") {
        if (event.event_type === "break_end") {
          breakSeconds += (ts - pendingBreakStart) / 1000;
          state = "in";
          addSite(event.site_id);
          geofenceVerified &&= event.geofence_verified;
        }
      }
    }

    if (state !== "none") pushSession(null); // dangling session, never closed
  }

  return sessions.sort((a, b) => toMs(a.started_at) - toMs(b.started_at));
}

// Same query surface as lib/notify.ts's Queryable -- works with the shared
// pool or a transaction client.
type Queryable = Pick<Pool | PoolClient, "query">;

const RANGE_PAD_DAYS = 2;

// Fetches timeclock_entries widened past the requested range (a session
// that started before date_from or ends after date_to still needs its full
// event set to pair correctly), computes sessions, then trims back to what
// was actually requested. Was inlined separately in GET /timesheets/sessions
// and GET /reports/timesheets.csv until a third caller (reconciliation)
// made that a real duplicate, not just a coincidence.
export async function fetchSessionsInRange(
  db: Queryable,
  filters: { crew_member_id?: string; date_from?: string; date_to?: string },
): Promise<TimeclockSession[]> {
  const { crew_member_id, date_from, date_to } = filters;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (crew_member_id) {
    params.push(crew_member_id);
    conditions.push(`crew_member_id = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conditions.push(`timestamp >= $${params.length}::date - interval '${RANGE_PAD_DAYS} days'`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`timestamp < ($${params.length}::date + interval '${RANGE_PAD_DAYS + 1} days')`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.query(
    `SELECT crew_member_id, event_type, site_id, timestamp, geofence_verified
     FROM timeclock_entries
     ${where}
     ORDER BY crew_member_id, timestamp`,
    params,
  );

  let sessions = computeSessions(result.rows);

  if (date_from) {
    const from = new Date(`${date_from}T00:00:00.000Z`).getTime();
    sessions = sessions.filter((s) => (s.ended_at ? new Date(s.ended_at).getTime() : Infinity) >= from);
  }
  if (date_to) {
    const to = new Date(`${date_to}T23:59:59.999Z`).getTime();
    sessions = sessions.filter((s) => new Date(s.started_at).getTime() <= to);
  }

  return sessions;
}
