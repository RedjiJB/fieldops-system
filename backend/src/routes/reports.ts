import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { toCsv } from "../lib/csv.js";
import { computeSessions } from "../lib/timeclock.js";

export const reportsRouter = Router();

// Same padding rationale as GET /timesheets/sessions -- a session that
// started before date_from or ends after date_to still needs its full
// event set to pair correctly.
const TIMESHEET_RANGE_PAD_DAYS = 2;

// pg returns TIMESTAMPTZ/DATE columns as JS Date objects, whose default
// String() is the verbose "Thu Aug 13 2026 ... GMT+0000 (...)" form -- not
// useful in a CSV meant to be opened in a spreadsheet.
function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function dateOnlyOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function sendCsv(res: import("express").Response, filename: string, csv: string) {
  res.type("text/csv");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
  res.send(csv);
}

reportsRouter.get(
  "/reports/jobs.csv",
  asyncHandler(async (req, res) => {
    const { date_from, date_to, site_id } = req.query;
    const result = await pool.query(
      `SELECT j.date, s.name AS site_name, jt.name AS job_type_name, j.status,
              j.started_at, COALESCE(cm1.name, u1.name) AS started_by_name,
              j.completed_at, COALESCE(cm2.name, u2.name) AS completed_by_name
       FROM jobs j
       LEFT JOIN sites s ON s.id = j.site_id
       LEFT JOIN job_types jt ON jt.id = j.job_type_id
       LEFT JOIN crew_members cm1 ON cm1.id = j.started_by
       LEFT JOIN users u1 ON u1.id = j.started_by_user_id
       LEFT JOIN crew_members cm2 ON cm2.id = j.completed_by
       LEFT JOIN users u2 ON u2.id = j.completed_by_user_id
       WHERE ($1::date IS NULL OR j.date >= $1)
         AND ($2::date IS NULL OR j.date <= $2)
         AND ($3::uuid IS NULL OR j.site_id = $3)
       ORDER BY j.date DESC`,
      [date_from ?? null, date_to ?? null, site_id ?? null],
    );

    const csv = toCsv(result.rows, [
      { header: "Date", value: (r) => dateOnlyOrNull(r.date) },
      { header: "Site", value: (r) => r.site_name },
      { header: "Job Type", value: (r) => r.job_type_name },
      { header: "Status", value: (r) => r.status },
      { header: "Started At", value: (r) => isoOrNull(r.started_at) },
      { header: "Started By", value: (r) => r.started_by_name },
      { header: "Completed At", value: (r) => isoOrNull(r.completed_at) },
      { header: "Completed By", value: (r) => r.completed_by_name },
    ]);
    sendCsv(res, "jobs.csv", csv);
  }),
);

reportsRouter.get(
  "/reports/checkouts.csv",
  asyncHandler(async (req, res) => {
    const { date_from, date_to, asset_id } = req.query;
    const result = await pool.query(
      `SELECT a.name AS asset_name, cm1.name AS checked_out_by_name, c.checked_out_at,
              COALESCE(cm2.name, u2.name) AS returned_by_name, c.checked_in_at,
              c.damage_flag, c.damage_note
       FROM checkouts c
       JOIN assets a ON a.id = c.asset_id
       LEFT JOIN crew_members cm1 ON cm1.id = c.checked_out_by
       LEFT JOIN crew_members cm2 ON cm2.id = c.returned_by
       LEFT JOIN users u2 ON u2.id = c.returned_by_user_id
       WHERE ($1::timestamptz IS NULL OR c.checked_out_at >= $1)
         AND ($2::timestamptz IS NULL OR c.checked_out_at <= $2)
         AND ($3::uuid IS NULL OR c.asset_id = $3)
       ORDER BY c.checked_out_at DESC`,
      [date_from ?? null, date_to ?? null, asset_id ?? null],
    );

    const csv = toCsv(result.rows, [
      { header: "Asset", value: (r) => r.asset_name },
      { header: "Checked Out By", value: (r) => r.checked_out_by_name },
      { header: "Checked Out At", value: (r) => isoOrNull(r.checked_out_at) },
      { header: "Returned By", value: (r) => r.returned_by_name },
      { header: "Checked In At", value: (r) => isoOrNull(r.checked_in_at) },
      { header: "Damaged", value: (r) => r.damage_flag },
      { header: "Damage Note", value: (r) => r.damage_note },
    ]);
    sendCsv(res, "checkouts.csv", csv);
  }),
);

reportsRouter.get(
  "/reports/purchase-orders.csv",
  asyncHandler(async (req, res) => {
    const { date_from, date_to, vendor_id } = req.query;
    const result = await pool.query(
      `SELECT po.created_at, v.name AS vendor_name, s.name AS site_name, po.status,
              po.cost, po.eta, po.sent_to
       FROM purchase_orders po
       LEFT JOIN vendors v ON v.id = po.vendor_id
       LEFT JOIN orders o ON o.id = po.order_id
       LEFT JOIN sites s ON s.id = o.site_id
       WHERE ($1::timestamptz IS NULL OR po.created_at >= $1)
         AND ($2::timestamptz IS NULL OR po.created_at <= $2)
         AND ($3::uuid IS NULL OR po.vendor_id = $3)
       ORDER BY po.created_at DESC`,
      [date_from ?? null, date_to ?? null, vendor_id ?? null],
    );

    const csv = toCsv(result.rows, [
      { header: "Date", value: (r) => isoOrNull(r.created_at) },
      { header: "Vendor", value: (r) => r.vendor_name },
      { header: "Site", value: (r) => r.site_name },
      { header: "Status", value: (r) => r.status },
      { header: "Cost", value: (r) => r.cost },
      { header: "ETA", value: (r) => dateOnlyOrNull(r.eta) },
      { header: "Sent To", value: (r) => r.sent_to },
    ]);
    sendCsv(res, "purchase-orders.csv", csv);
  }),
);

reportsRouter.get(
  "/reports/timesheets.csv",
  asyncHandler(async (req, res) => {
    const { date_from, date_to, crew_member_id } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (crew_member_id) {
      params.push(crew_member_id);
      conditions.push(`crew_member_id = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conditions.push(`timestamp >= $${params.length}::date - interval '${TIMESHEET_RANGE_PAD_DAYS} days'`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`timestamp < ($${params.length}::date + interval '${TIMESHEET_RANGE_PAD_DAYS + 1} days')`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
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

    const crewIds = [...new Set(sessions.map((s) => s.crew_member_id))];
    const namesResult = crewIds.length
      ? await pool.query(`SELECT id, name FROM crew_members WHERE id = ANY($1::uuid[])`, [crewIds])
      : { rows: [] as { id: string; name: string }[] };
    const nameById = new Map(namesResult.rows.map((r) => [r.id, r.name]));

    const sitesResult = await pool.query(`SELECT id, name FROM sites`);
    const siteNameById = new Map(sitesResult.rows.map((r) => [r.id, r.name]));

    const csv = toCsv(sessions, [
      { header: "Crew Member", value: (s) => nameById.get(s.crew_member_id) ?? s.crew_member_id },
      { header: "Started At", value: (s) => s.started_at },
      { header: "Ended At", value: (s) => s.ended_at },
      { header: "Break (min)", value: (s) => Math.round(s.break_seconds / 60) },
      { header: "Net Hours", value: (s) => (s.net_seconds === null ? null : (s.net_seconds / 3600).toFixed(2)) },
      { header: "Sites", value: (s) => s.site_ids.map((id) => siteNameById.get(id) ?? id).join("; ") },
      { header: "Geofence Verified", value: (s) => s.geofence_verified },
      { header: "Status", value: (s) => (s.incomplete ? "incomplete" : "complete") },
    ]);
    sendCsv(res, "timesheets.csv", csv);
  }),
);
