import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { fetchSessionsInRange } from "../lib/timeclock.js";

export const meRouter = Router();

// Every route here derives crew_member_id from req.auth.crewMemberId --
// never from a query param or the URL -- so there is no way for one crew
// member to see another's data by editing a request. This is the crew
// dashboard portal's whole reason to exist: scoped, server-side, not a
// frontend filter over an admin-shaped route.
function requireCrewSession(req: import("express").Request): string {
  if (req.auth?.type !== "crew") throw new HttpError(403, "Crew session required");
  return req.auth.crewMemberId;
}

// Foreman's "a little more" tier: site roster, site checkouts, site
// pending orders. management/owner also reach these three routes -- but,
// corrected 2026-08-16 after review, NOT scoped identically to foreman
// anymore (see resolveVisibleSiteIds below). foreman stays scoped to
// wherever *they themselves* have a shift today, a genuinely narrower
// tier; management/owner see every active site's data, org-wide -- their
// actual "even more" tier, distinct from foreman rather than a relabeled
// copy of it. yard is deliberately excluded -- nothing was asked for it.
const FOREMAN_TIER_ROLES = ["foreman", "management", "owner"];
const MANAGEMENT_TIER_ROLES = ["management", "owner"];

function requireForemanTierSession(req: import("express").Request): { crewMemberId: string; role: string } {
  if (req.auth?.type !== "crew") throw new HttpError(403, "Crew session required");
  if (!FOREMAN_TIER_ROLES.includes(req.auth.role)) {
    throw new HttpError(403, "This view is only available to foreman, management, or owner crew sessions");
  }
  return { crewMemberId: req.auth.crewMemberId, role: req.auth.role };
}

// Foreman: "their site" = wherever they have a confirmed shift today --
// same definition backend/src/workers/exceptions.ts already uses for
// checkWrongSite/checkVehicleDark/checkDelayedArrivals, not a fixed
// per-person site assignment (none exists in this schema). Multiple
// confirmed shifts today means multiple sites; none today means an empty
// site list, and every route below returns an empty result rather than
// erroring in that case.
//
// management/owner: every site with any confirmed shift today, not just
// their own -- the actual breadth difference from foreman's tier.
async function resolveVisibleSiteIds(crewMemberId: string, role: string): Promise<string[]> {
  if (MANAGEMENT_TIER_ROLES.includes(role)) {
    const result = await pool.query(`SELECT DISTINCT site_id FROM shifts WHERE date = CURRENT_DATE AND status = 'confirmed'`);
    return result.rows.map((r) => r.site_id);
  }
  const result = await pool.query(
    `SELECT DISTINCT site_id FROM shifts WHERE crew_member_id = $1 AND date = CURRENT_DATE AND status = 'confirmed'`,
    [crewMemberId],
  );
  return result.rows.map((r) => r.site_id);
}

meRouter.get(
  "/me/pay",
  asyncHandler(async (req, res) => {
    const crewMemberId = requireCrewSession(req);
    const profileResult = await pool.query(
      `SELECT COALESCE(pay_type, 'payroll') AS pay_type, hourly_rate, updated_at
       FROM crew_pay_profiles WHERE crew_member_id = $1`,
      [crewMemberId],
    );
    const payoutsResult = await pool.query(
      `SELECT id, amount, paid_at, note FROM payouts WHERE crew_member_id = $1 ORDER BY paid_at DESC`,
      [crewMemberId],
    );
    res.json({ profile: profileResult.rows[0] ?? { pay_type: "payroll", hourly_rate: null, updated_at: null }, payouts: payoutsResult.rows });
  }),
);

meRouter.get(
  "/me/shifts",
  asyncHandler(async (req, res) => {
    const crewMemberId = requireCrewSession(req);
    const { date_from, date_to } = req.query;

    const shiftsResult = await pool.query(
      `SELECT sh.*, s.name AS site_name
       FROM shifts sh
       LEFT JOIN sites s ON s.id = sh.site_id
       WHERE sh.crew_member_id = $1
       ORDER BY sh.date DESC, sh.start_time`,
      [crewMemberId],
    );
    const sessions = await fetchSessionsInRange(pool, {
      crew_member_id: crewMemberId,
      date_from: date_from as string | undefined,
      date_to: date_to as string | undefined,
    });
    res.json({ shifts: shiftsResult.rows, timeclock_sessions: sessions });
  }),
);

meRouter.get(
  "/me/checkouts",
  asyncHandler(async (req, res) => {
    const crewMemberId = requireCrewSession(req);
    const result = await pool.query(
      `SELECT c.*, a.name AS asset_name, a.category AS asset_category
       FROM checkouts c
       JOIN assets a ON a.id = c.asset_id
       WHERE c.checked_out_by = $1
       ORDER BY c.checked_out_at DESC`,
      [crewMemberId],
    );
    res.json(result.rows);
  }),
);

meRouter.get(
  "/me/spend-records",
  asyncHandler(async (req, res) => {
    const crewMemberId = requireCrewSession(req);
    const result = await pool.query(
      `SELECT sr.*, d.filename AS document_filename
       FROM spend_records sr
       LEFT JOIN documents d ON d.id = sr.document_id
       WHERE sr.crew_member_id = $1 OR sr.submitted_by = $1
       ORDER BY sr.occurred_at DESC`,
      [crewMemberId],
    );
    res.json(result.rows);
  }),
);

// Everyone with a confirmed shift at the site today, not just crew --
// includes the calling foreman themselves. Latest timeclock event per
// person (LATERAL, same pattern checkIdleCrew in exceptions.ts uses) gives
// a rough on-site/off-site read without a dedicated attendance concept.
meRouter.get(
  "/me/site-roster",
  asyncHandler(async (req, res) => {
    const { crewMemberId, role } = requireForemanTierSession(req);
    const siteIds = await resolveVisibleSiteIds(crewMemberId, role);
    if (siteIds.length === 0) {
      res.json([]);
      return;
    }
    const result = await pool.query(
      `SELECT cm.id AS crew_member_id, cm.name, cm.role, sh.site_id, s.name AS site_name,
              t.event_type AS last_event_type, t.timestamp AS last_event_at
       FROM shifts sh
       JOIN crew_members cm ON cm.id = sh.crew_member_id
       JOIN sites s ON s.id = sh.site_id
       LEFT JOIN LATERAL (
         SELECT event_type, timestamp FROM timeclock_entries
         WHERE crew_member_id = sh.crew_member_id
         ORDER BY timestamp DESC LIMIT 1
       ) t ON true
       WHERE sh.date = CURRENT_DATE AND sh.status = 'confirmed' AND sh.site_id = ANY($1)
       ORDER BY s.name, cm.name`,
      [siteIds],
    );
    res.json(result.rows);
  }),
);

// Everything currently checked out at the foreman's site(s) today, not
// just their own -- distinct from GET /me/checkouts above, which is
// scoped to checkouts BY this crew member specifically.
meRouter.get(
  "/me/site-checkouts",
  asyncHandler(async (req, res) => {
    const { crewMemberId, role } = requireForemanTierSession(req);
    const siteIds = await resolveVisibleSiteIds(crewMemberId, role);
    if (siteIds.length === 0) {
      res.json([]);
      return;
    }
    const result = await pool.query(
      `SELECT c.*, a.name AS asset_name, a.category AS asset_category, cm.name AS checked_out_by_name
       FROM checkouts c
       JOIN assets a ON a.id = c.asset_id
       JOIN crew_members cm ON cm.id = c.checked_out_by
       WHERE a.current_site_id = ANY($1) AND c.checked_in_at IS NULL
       ORDER BY c.checked_out_at DESC`,
      [siteIds],
    );
    res.json(result.rows);
  }),
);

// Orders requested for the foreman's site(s) -- visibility into supply
// requests without asking the agent over WhatsApp. Same two-query
// order+items shape as GET /orders/:id, just fetched for every order at
// once instead of a single one.
meRouter.get(
  "/me/site-orders",
  asyncHandler(async (req, res) => {
    const { crewMemberId, role } = requireForemanTierSession(req);
    const siteIds = await resolveVisibleSiteIds(crewMemberId, role);
    if (siteIds.length === 0) {
      res.json([]);
      return;
    }
    const ordersResult = await pool.query(
      `SELECT o.*, s.name AS site_name, cm.name AS requester_name
       FROM orders o
       JOIN sites s ON s.id = o.site_id
       JOIN crew_members cm ON cm.id = o.requester_id
       WHERE o.site_id = ANY($1)
       ORDER BY o.created_at DESC`,
      [siteIds],
    );
    const orderIds = ordersResult.rows.map((o) => o.id);
    const itemsResult = orderIds.length
      ? await pool.query(
          `SELECT oi.*, COALESCE(a.name, c.name) AS item_name
           FROM order_items oi
           LEFT JOIN assets a ON oi.asset_id = a.id
           LEFT JOIN consumables c ON oi.consumable_id = c.id
           WHERE oi.order_id = ANY($1)
           ORDER BY oi.id`,
          [orderIds],
        )
      : { rows: [] };
    const itemsByOrder = new Map<string, typeof itemsResult.rows>();
    for (const item of itemsResult.rows) {
      const list = itemsByOrder.get(item.order_id) ?? [];
      list.push(item);
      itemsByOrder.set(item.order_id, list);
    }
    res.json(ordersResult.rows.map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] })));
  }),
);
