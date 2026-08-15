import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { toCsv } from "../lib/csv.js";
import { fetchSessionsInRange } from "../lib/timeclock.js";
import { requireAdmin } from "../lib/roles.js";

export const reportsRouter = Router();

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

// Not admin-gated, matching PATCH /order-items/:id's own precedent (see
// orders.ts) -- purchase_orders.cost is operational cost data, same as
// material cost elsewhere in this app, not wage/cash-handling data.
// Shared between the JSON route (on-screen Reports table) and the CSV
// route, same "build once, both consumers" pattern as
// buildPeriodCloseSummary above.
async function buildVendorSpendSummary(date_from?: string, date_to?: string) {
  const result = await pool.query(
    `SELECT v.name AS vendor_name, date_trunc('month', po.created_at) AS month,
            COUNT(*) AS po_count, SUM(po.cost) AS total_cost
     FROM purchase_orders po
     JOIN vendors v ON v.id = po.vendor_id
     WHERE po.cost IS NOT NULL
       AND ($1::date IS NULL OR po.created_at >= $1)
       AND ($2::date IS NULL OR po.created_at < ($2::date + interval '1 day'))
     GROUP BY v.name, date_trunc('month', po.created_at)
     ORDER BY date_trunc('month', po.created_at) DESC, total_cost DESC`,
    [date_from ?? null, date_to ?? null],
  );
  return result.rows;
}

reportsRouter.get(
  "/reports/vendor-spend",
  asyncHandler(async (req, res) => {
    const { date_from, date_to } = req.query;
    res.json(await buildVendorSpendSummary(date_from as string | undefined, date_to as string | undefined));
  }),
);

reportsRouter.get(
  "/reports/vendor-spend.csv",
  asyncHandler(async (req, res) => {
    const { date_from, date_to } = req.query;
    const rows = await buildVendorSpendSummary(date_from as string | undefined, date_to as string | undefined);
    const csv = toCsv(rows, [
      { header: "Vendor", value: (r) => r.vendor_name },
      { header: "Month", value: (r) => dateOnlyOrNull(r.month) },
      { header: "PO Count", value: (r) => r.po_count },
      { header: "Total Cost", value: (r) => r.total_cost },
    ]);
    sendCsv(res, "vendor-spend.csv", csv);
  }),
);

reportsRouter.get(
  "/reports/timesheets.csv",
  asyncHandler(async (req, res) => {
    const { date_from, date_to, crew_member_id } = req.query;
    const sessions = await fetchSessionsInRange(pool, {
      crew_member_id: crew_member_id as string | undefined,
      date_from: date_from as string | undefined,
      date_to: date_to as string | undefined,
    });

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

// Composes 5 sub-queries into one rollup for a bookkeeper/accountant at
// month/quarter close -- completed jobs, hours, spend, missing receipts, and
// anomalies (alerts) all in the same date_from/date_to window. Shared by the
// JSON route (on-screen dashboard rollup) and the CSV route (the actual
// "hand to a bookkeeper" export) so the two can't drift out of sync.
async function buildPeriodCloseSummary(date_from: string, date_to: string) {
  const jobsResult = await pool.query(
    `SELECT j.id, j.date, s.name AS site_name, jt.name AS job_type_name,
            j.completed_at, COALESCE(cm.name, u.name) AS completed_by_name
     FROM jobs j
     LEFT JOIN sites s ON s.id = j.site_id
     LEFT JOIN job_types jt ON jt.id = j.job_type_id
     LEFT JOIN crew_members cm ON cm.id = j.completed_by
     LEFT JOIN users u ON u.id = j.completed_by_user_id
     WHERE j.status = 'complete'
       AND j.completed_at >= $1
       AND j.completed_at < ($2::date + interval '1 day')
     ORDER BY j.completed_at`,
    [date_from, date_to],
  );

  // Same "never fold incomplete into totals as zero" idiom as
  // payroll.ts's reconciliation route -- an incomplete session's hours
  // are unknown, not zero, so it's counted separately rather than dropped
  // or guessed.
  const sessions = await fetchSessionsInRange(pool, { date_from, date_to });
  const hoursByCrew = new Map<string, { completedSeconds: number; incompleteCount: number }>();
  for (const s of sessions) {
    const entry = hoursByCrew.get(s.crew_member_id) ?? { completedSeconds: 0, incompleteCount: 0 };
    if (s.incomplete) entry.incompleteCount += 1;
    else entry.completedSeconds += s.net_seconds ?? 0;
    hoursByCrew.set(s.crew_member_id, entry);
  }
  const crewIds = [...hoursByCrew.keys()];
  const namesResult = crewIds.length
    ? await pool.query(`SELECT id, name FROM crew_members WHERE id = ANY($1::uuid[])`, [crewIds])
    : { rows: [] as { id: string; name: string }[] };
  const nameById = new Map(namesResult.rows.map((r) => [r.id, r.name]));
  const hours = crewIds
    .map((id) => {
      const e = hoursByCrew.get(id)!;
      return {
        crew_member_id: id,
        crew_member_name: nameById.get(id) ?? id,
        completed_hours: e.completedSeconds / 3600,
        incomplete_sessions: e.incompleteCount,
      };
    })
    .sort((a, b) => a.crew_member_name.localeCompare(b.crew_member_name));

  const spendResult = await pool.query(
    `SELECT category, COUNT(*) AS count, SUM(amount) AS total_amount
     FROM spend_records
     WHERE status = 'approved'
       AND occurred_at >= $1
       AND occurred_at < ($2::date + interval '1 day')
     GROUP BY category
     ORDER BY category`,
    [date_from, date_to],
  );

  // Same query shape as GET /spend-records/missing-receipts, scoped to this
  // period -- ties the two backlog items together as one callout rather
  // than a second unrelated lookup.
  const missingReceiptsResult = await pool.query(
    `SELECT sr.*, cm.name AS crew_member_name, COALESCE(u1.name, cm1.name) AS submitted_by_name
     FROM spend_records sr
     LEFT JOIN crew_members cm ON cm.id = sr.crew_member_id
     LEFT JOIN users u1 ON u1.id = sr.submitted_by_user_id
     LEFT JOIN crew_members cm1 ON cm1.id = sr.submitted_by
     WHERE sr.document_id IS NULL AND sr.category != 'mileage' AND sr.status = 'approved'
       AND sr.occurred_at >= $1
       AND sr.occurred_at < ($2::date + interval '1 day')
     ORDER BY sr.occurred_at DESC`,
    [date_from, date_to],
  );
  const missingTotal = missingReceiptsResult.rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  // "Anomalies" here is a summary (type/site/timestamps), not the fully
  // resolved per-alert message the Alerts dashboard page already builds --
  // related_record_id is polymorphic per alert type, and re-resolving it
  // to a human sentence belongs to that detail view, not this rollup.
  const alertsResult = await pool.query(
    `SELECT a.id, a.type, s.name AS site_name, a.raised_at, a.resolved_at
     FROM alerts a
     LEFT JOIN sites s ON s.id = a.site_id
     WHERE a.raised_at >= $1
       AND a.raised_at < ($2::date + interval '1 day')
     ORDER BY a.raised_at`,
    [date_from, date_to],
  );
  const byType = new Map<string, number>();
  for (const a of alertsResult.rows) byType.set(a.type, (byType.get(a.type) ?? 0) + 1);

  return {
    date_from,
    date_to,
    jobs: jobsResult.rows,
    hours,
    spend: spendResult.rows,
    missing_receipts: {
      count: missingReceiptsResult.rows.length,
      total_amount: missingTotal,
      records: missingReceiptsResult.rows,
    },
    anomalies: {
      by_type: [...byType.entries()].map(([type, count]) => ({ type, count })),
      alerts: alertsResult.rows,
    },
  };
}

function requirePeriodCloseRange(req: import("express").Request) {
  const { date_from, date_to } = req.query;
  if (!date_from || !date_to) throw new HttpError(400, "date_from and date_to are required");
  return { date_from: date_from as string, date_to: date_to as string };
}

reportsRouter.get(
  "/reports/period-close",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { date_from, date_to } = requirePeriodCloseRange(req);
    res.json(await buildPeriodCloseSummary(date_from, date_to));
  }),
);

// Multi-section CSV -- unlike every other report here, a period-close
// rollup isn't one flat table, so this concatenates a title block plus one
// toCsv() call per section (each already ends in \r\n), separated by a
// blank line and a section-title line. Meant for a human/bookkeeper to
// scan or copy-paste section by section, not to be machine-reparsed as one
// flat table.
reportsRouter.get(
  "/reports/period-close.csv",
  asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { date_from, date_to } = requirePeriodCloseRange(req);
    const summary = await buildPeriodCloseSummary(date_from, date_to);

    const totalSpend = summary.spend.reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0);
    const parts: string[] = [];

    parts.push(`Period Close Summary: ${summary.date_from} to ${summary.date_to}\r\n\r\n`);
    parts.push(
      toCsv(
        [
          {
            completed_jobs: summary.jobs.length,
            total_spend: totalSpend,
            missing_receipts: summary.missing_receipts.count,
            anomalies: summary.anomalies.alerts.length,
          },
        ],
        [
          { header: "Completed Jobs", value: (r) => r.completed_jobs },
          { header: "Total Spend", value: (r) => r.total_spend },
          { header: "Missing Receipts", value: (r) => r.missing_receipts },
          { header: "Anomalies", value: (r) => r.anomalies },
        ],
      ),
    );

    parts.push("\r\nCompleted Jobs\r\n");
    parts.push(
      toCsv(summary.jobs, [
        { header: "Date", value: (r) => dateOnlyOrNull(r.date) },
        { header: "Site", value: (r) => r.site_name },
        { header: "Job Type", value: (r) => r.job_type_name },
        { header: "Completed At", value: (r) => isoOrNull(r.completed_at) },
        { header: "Completed By", value: (r) => r.completed_by_name },
      ]),
    );

    parts.push("\r\nHours by Crew Member\r\n");
    parts.push(
      toCsv(summary.hours, [
        { header: "Crew Member", value: (r) => r.crew_member_name },
        { header: "Hours", value: (r) => r.completed_hours.toFixed(2) },
        { header: "Incomplete Sessions", value: (r) => r.incomplete_sessions },
      ]),
    );

    parts.push("\r\nSpend by Category\r\n");
    parts.push(
      toCsv(summary.spend, [
        { header: "Category", value: (r) => r.category },
        { header: "Count", value: (r) => r.count },
        { header: "Total Amount", value: (r) => r.total_amount },
      ]),
    );

    parts.push("\r\nMissing Receipts\r\n");
    parts.push(
      toCsv(summary.missing_receipts.records, [
        { header: "Date", value: (r) => isoOrNull(r.occurred_at) },
        { header: "Crew Member", value: (r) => r.crew_member_name },
        { header: "Category", value: (r) => r.category },
        { header: "Method", value: (r) => r.method },
        { header: "Amount", value: (r) => r.amount },
        { header: "Description", value: (r) => r.description },
      ]),
    );

    parts.push("\r\nAnomalies\r\n");
    parts.push(
      toCsv(summary.anomalies.alerts, [
        { header: "Type", value: (r) => r.type },
        { header: "Site", value: (r) => r.site_name },
        { header: "Raised At", value: (r) => isoOrNull(r.raised_at) },
        { header: "Resolved At", value: (r) => isoOrNull(r.resolved_at) },
        { header: "Resolved", value: (r) => r.resolved_at !== null },
      ]),
    );

    sendCsv(res, "period-close.csv", parts.join(""));
  }),
);
