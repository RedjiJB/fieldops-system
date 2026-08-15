import type { Request } from "express";
import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { insertNotification } from "../lib/notify.js";
import { requireAdmin } from "../lib/roles.js";
import { LEGAL_NEXT_EVENTS, TIMECLOCK_EVENTS } from "./shifts.js";
import { PO_FULFILLABLE_STATUSES } from "./vendors.js";

export const confirmationsRouter = Router();

const ACTION_TYPES = [
  "timeclock_event",
  "consumable_adjustment",
  "checkout_return",
  "mileage_claim",
  "asset_verification",
  "purchase_order_fulfillment",
] as const;
type ActionType = (typeof ACTION_TYPES)[number];

// Every mutating agent tool eventually needs this same two-party gate; this
// is a pilot on six self-reported physical-reality/money claims where the
// crew member's own confirmation isn't independent verification of
// anything (hours, material-usage, damage claims, mileage, asset
// verification, PO fulfillment) -- not a cutover of the agent's other ~50
// mutating tools -- see docs/ARCHITECTURE.md.
function requireServiceToken(req: Request) {
  if (req.auth?.type !== "service") {
    throw new HttpError(403, "Only the agent service token can create pending confirmations");
  }
}

type Reviewer = { reviewedBy: string | null; reviewedByUserId: string | null };

// Dashboard admin (requireAdmin, unchanged) or a management-role crew
// member via the service token (the WhatsApp path) -- the first place
// crew_members.role is ever read for authorization; every other route in
// this codebase treats it as informational only.
async function resolveReviewer(req: Request): Promise<Reviewer> {
  if (req.auth?.type === "user") {
    const auth = requireAdmin(req);
    return { reviewedBy: null, reviewedByUserId: auth.userId };
  }
  if (req.auth?.type === "service") {
    const { reviewed_by } = req.body;
    if (!reviewed_by) throw new HttpError(400, "reviewed_by is required");
    const crewResult = await pool.query("SELECT role FROM crew_members WHERE id = $1", [reviewed_by]);
    const crew = crewResult.rows[0];
    if (!crew) throw new HttpError(404, "Crew member not found");
    if (crew.role !== "management" && crew.role !== "owner") {
      throw new HttpError(403, "Only a management or owner-role crew member can approve/reject a pending confirmation");
    }
    return { reviewedBy: reviewed_by, reviewedByUserId: null };
  }
  throw new HttpError(403, "Not authorized");
}

function validatePayload(actionType: ActionType, payload: Record<string, unknown>) {
  if (actionType === "timeclock_event") {
    if (!TIMECLOCK_EVENTS.includes(payload.event_type as (typeof TIMECLOCK_EVENTS)[number])) {
      throw new HttpError(400, `payload.event_type must be one of: ${TIMECLOCK_EVENTS.join(", ")}`);
    }
  } else if (actionType === "consumable_adjustment") {
    if (!payload.consumable_id || typeof payload.delta !== "number") {
      throw new HttpError(400, "payload.consumable_id and payload.delta (number) are required");
    }
  } else if (actionType === "checkout_return") {
    if (!payload.checkout_id) throw new HttpError(400, "payload.checkout_id is required");
  } else if (actionType === "mileage_claim") {
    if (typeof payload.distance_km !== "number" || payload.distance_km <= 0) {
      throw new HttpError(400, "payload.distance_km (positive number) is required");
    }
  } else if (actionType === "asset_verification") {
    if (!payload.asset_id) throw new HttpError(400, "payload.asset_id is required");
  } else if (actionType === "purchase_order_fulfillment") {
    if (!payload.purchase_order_id) throw new HttpError(400, "payload.purchase_order_id is required");
  }
}

confirmationsRouter.post(
  "/pending-confirmations",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { action_type, summary, payload, crew_member_id } = req.body;
    if (!ACTION_TYPES.includes(action_type)) {
      throw new HttpError(400, `action_type must be one of: ${ACTION_TYPES.join(", ")}`);
    }
    if (!summary) throw new HttpError(400, "summary is required");
    if (!crew_member_id) throw new HttpError(400, "crew_member_id is required");
    if (!payload || typeof payload !== "object") throw new HttpError(400, "payload is required");
    validatePayload(action_type, payload);

    const notificationId = await insertNotification(pool, "critical", summary, "pending_confirmation", null);
    const result = await pool.query(
      `INSERT INTO pending_confirmations (action_type, summary, payload, crew_member_id, notification_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [action_type, summary, JSON.stringify(payload), crew_member_id, notificationId],
    );

    // source_id couldn't be set until the pending_confirmations row existed
    // (the notification has to exist first so there's an id to link back to).
    await pool.query(`UPDATE notifications SET source_id = $2 WHERE id = $1`, [
      notificationId,
      result.rows[0].id,
    ]);

    res.status(201).json(result.rows[0]);
  }),
);

// Dashboard sessions still need admin; the service token passes through
// ungated (same trust boundary as GET /notifications/pending, which the
// notifier already polls freely) -- this is what lets the agent look up
// what's open when management asks over WhatsApp.
// Crew-session leak fixed alongside the equivalent one on GET
// /spend-records (spending.ts): a crew-type dashboard session fell through
// this route's admin gate exactly like the service token, with no scoping
// -- any crew member's magic-link session could browse every OTHER crew
// member's pending confirmations (mileage claims, timeclock events, etc.),
// confirmed live during a security pass. There's no current dashboard UI
// that needs a crew session to see anyone else's, management-role included
// -- that review happens over WhatsApp via the service token, not this
// route -- so this forces crew_member_id to the session's own id
// regardless of role, same as /me/* routes, never trusted from the query
// string for this auth type.
confirmationsRouter.get(
  "/pending-confirmations",
  asyncHandler(async (req, res) => {
    if (req.auth?.type === "user") requireAdmin(req);
    const { status, whatsapp_message_id } = req.query;
    const crew_member_id = req.auth?.type === "crew" ? req.auth.crewMemberId : (req.query.crew_member_id as string | undefined);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`pc.status = $${params.length}`);
    }
    if (whatsapp_message_id) {
      params.push(whatsapp_message_id);
      conditions.push(`n.whatsapp_message_id = $${params.length}`);
    }
    if (crew_member_id) {
      params.push(crew_member_id);
      conditions.push(`pc.crew_member_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT pc.*, cm.name AS crew_member_name, COALESCE(u.name, cm2.name) AS reviewed_by_name
       FROM pending_confirmations pc
       LEFT JOIN crew_members cm ON cm.id = pc.crew_member_id
       LEFT JOIN users u ON u.id = pc.reviewed_by_user_id
       LEFT JOIN crew_members cm2 ON cm2.id = pc.reviewed_by
       LEFT JOIN notifications n ON n.id = pc.notification_id
       ${where}
       ORDER BY pc.created_at DESC`,
      params,
    );
    res.json(result.rows);
  }),
);

// Polled by the new deliver-confirmation-outcomes.mjs, same shape as
// GET /notifications/pending -- not admin-gated, reachable by the service
// token, doesn't expose anything the crew member itself doesn't already
// know (their own submission).
confirmationsRouter.get(
  "/pending-confirmations/unnotified",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT pc.*, cm.name AS crew_member_name, cm.phone AS crew_member_phone
       FROM pending_confirmations pc
       JOIN crew_members cm ON cm.id = pc.crew_member_id
       WHERE pc.status IN ('approved', 'rejected', 'expired') AND pc.crew_notified_at IS NULL
       ORDER BY pc.created_at ASC`,
    );
    res.json(result.rows);
  }),
);

async function approveTimeclockEvent(client: PoolClient, pc: any): Promise<string> {
  const { crew_member_id } = pc;
  const { event_type, site_id, geofence_verified } = pc.payload;

  // Re-runs the exact legal-transition check shifts.ts's POST /timeclock
  // does -- state may have shifted while this sat awaiting approval.
  const lastResult = await client.query(
    `SELECT event_type FROM timeclock_entries
     WHERE crew_member_id = $1
     ORDER BY timestamp DESC
     LIMIT 1
     FOR UPDATE`,
    [crew_member_id],
  );
  const lastEvent = lastResult.rows[0]?.event_type ?? "none";
  const allowedNext = LEGAL_NEXT_EVENTS[lastEvent] ?? [];
  if (!allowedNext.includes(event_type)) {
    throw new HttpError(
      409,
      `Cannot log '${event_type}' — last event was '${lastEvent}'. Expected one of: ${allowedNext.join(", ")}`,
    );
  }

  const result = await client.query(
    `INSERT INTO timeclock_entries (crew_member_id, event_type, site_id, geofence_verified)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [crew_member_id, event_type, site_id ?? null, !!geofence_verified],
  );
  return result.rows[0].id;
}

async function approveConsumableAdjustment(client: PoolClient, pc: any): Promise<string> {
  const { consumable_id, delta } = pc.payload;
  const existing = await client.query("SELECT * FROM consumables WHERE id = $1", [consumable_id]);
  const consumable = existing.rows[0];
  if (!consumable) throw new HttpError(404, "Consumable not found");
  if (consumable.stocking_type !== "stocked") {
    throw new HttpError(
      400,
      "Only 'stocked' consumables carry an on-hand quantity; per_job_delivery items are ordered per job",
    );
  }

  const result = await client.query(
    `UPDATE consumables
     SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + $2, last_verified_at = now()
     WHERE id = $1
     RETURNING id`,
    [consumable_id, delta],
  );
  return result.rows[0].id;
}

async function approveCheckoutReturn(client: PoolClient, pc: any): Promise<string> {
  const { checkout_id, damage_flag, damage_note, photo_url } = pc.payload;
  const existingResult = await client.query("SELECT * FROM checkouts WHERE id = $1 FOR UPDATE", [checkout_id]);
  const existing = existingResult.rows[0];
  if (!existing) throw new HttpError(404, "Checkout not found");
  if (existing.checked_in_at) throw new HttpError(400, "This checkout was already returned");

  const checkoutResult = await client.query(
    `UPDATE checkouts
     SET checked_in_at = now(), damage_flag = $2, damage_note = $3, photo_url = $4, returned_by = $5
     WHERE id = $1
     RETURNING id`,
    [checkout_id, !!damage_flag, damage_note ?? null, photo_url ?? null, pc.crew_member_id],
  );

  const newAssetStatus = damage_flag ? "in_maintenance" : "available";
  await client.query("UPDATE assets SET status = $2, current_holder = NULL WHERE id = $1", [
    existing.asset_id,
    newAssetStatus,
  ]);

  return checkoutResult.rows[0].id;
}

async function approveMileageClaim(
  client: PoolClient,
  pc: any,
  ratePerKm: number,
  reviewer: Reviewer,
): Promise<string> {
  const { distance_km, description } = pc.payload;
  const amount = Number(distance_km) * ratePerKm;

  // Already 'approved', not spend_records' own default 'pending' -- the
  // two-party confirmation IS the approval event, this doesn't pass through
  // a second review. submitted_by/submitted_by_user_id mirror whichever
  // channel approved it -- a WhatsApp-approved claim has no dashboard user
  // id to put there, same dual-path convention as everywhere else.
  const result = await client.query(
    `INSERT INTO spend_records
       (category, method, status, amount, distance_km, rate_per_km, description,
        crew_member_id, submitted_by, submitted_by_user_id, reviewed_by, reviewed_by_user_id, reviewed_at)
     VALUES ('mileage', 'personal_reimbursed', 'approved', $1, $2, $3, $4, $5, $6, $7, $6, $7, now())
     RETURNING id`,
    [
      amount,
      distance_km,
      ratePerKm,
      description ?? null,
      pc.crew_member_id,
      reviewer.reviewedBy,
      reviewer.reviewedByUserId,
    ],
  );
  return result.rows[0].id;
}

async function approveAssetVerification(client: PoolClient, pc: any): Promise<string> {
  const { asset_id } = pc.payload;
  const existing = await client.query("SELECT * FROM assets WHERE id = $1 FOR UPDATE", [asset_id]);
  const asset = existing.rows[0];
  if (!asset) throw new HttpError(404, "Asset not found");
  if (asset.status === "retired") {
    throw new HttpError(
      409,
      "This asset was retired since the verification was submitted — no longer eligible to become available",
    );
  }

  const result = await client.query(
    `UPDATE assets SET status = 'available', last_verified_at = now(), verified_by = $2 WHERE id = $1 RETURNING id`,
    [asset_id, pc.crew_member_id],
  );
  return result.rows[0].id;
}

// fulfilled_by/fulfilled_by_user_id record the *reviewer* who approved
// this, not the crew member who originally submitted the fulfillment
// claim (pc.crew_member_id) -- "who approved this spend" is the whole
// point of an approval trail, so this deliberately mirrors reviewed_by/
// reviewed_by_user_id below rather than pc's own submitter.
async function approvePurchaseOrderFulfillment(
  client: PoolClient,
  pc: any,
  reviewer: { reviewedBy: string | null; reviewedByUserId: string | null },
): Promise<string> {
  const { purchase_order_id } = pc.payload;
  const existing = await client.query("SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE", [
    purchase_order_id,
  ]);
  const po = existing.rows[0];
  if (!po) throw new HttpError(404, "Purchase order not found");
  if (!PO_FULFILLABLE_STATUSES.includes(po.status)) {
    throw new HttpError(
      409,
      `Purchase order must be sent before it can be marked fulfilled (current status: ${po.status})`,
    );
  }

  const result = await client.query(
    `UPDATE purchase_orders
     SET status = 'fulfilled', fulfilled_at = now(),
         fulfilled_by = $2, fulfilled_by_user_id = $3
     WHERE id = $1 RETURNING id`,
    [purchase_order_id, reviewer.reviewedBy, reviewer.reviewedByUserId],
  );
  return result.rows[0].id;
}

// 'disputed' is reviewable by the same route as 'awaiting_management' -- a
// contested rejection goes back through the exact same approve/reject
// decision, not a separate code path. See 0062_dispute_appeal_path.sql.
const REVIEWABLE_STATUSES = ["awaiting_management", "disputed"];

confirmationsRouter.patch(
  "/pending-confirmations/:id/approve",
  asyncHandler(async (req, res) => {
    const reviewer = await resolveReviewer(req);
    const { rate_per_km } = req.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query("SELECT * FROM pending_confirmations WHERE id = $1 FOR UPDATE", [
        req.params.id,
      ]);
      const pc = existing.rows[0];
      if (!pc) throw new HttpError(404, "Pending confirmation not found");
      if (!REVIEWABLE_STATUSES.includes(pc.status)) {
        throw new HttpError(400, "This confirmation has already been reviewed");
      }

      let resultId: string;
      if (pc.action_type === "timeclock_event") {
        resultId = await approveTimeclockEvent(client, pc);
      } else if (pc.action_type === "consumable_adjustment") {
        resultId = await approveConsumableAdjustment(client, pc);
      } else if (pc.action_type === "checkout_return") {
        resultId = await approveCheckoutReturn(client, pc);
      } else if (pc.action_type === "mileage_claim") {
        if (typeof rate_per_km !== "number" || rate_per_km < 0) {
          throw new HttpError(400, "rate_per_km (non-negative number) is required to approve a mileage claim");
        }
        resultId = await approveMileageClaim(client, pc, rate_per_km, reviewer);
      } else if (pc.action_type === "asset_verification") {
        resultId = await approveAssetVerification(client, pc);
      } else if (pc.action_type === "purchase_order_fulfillment") {
        resultId = await approvePurchaseOrderFulfillment(client, pc, reviewer);
      } else {
        throw new HttpError(500, `Unknown action_type: ${pc.action_type}`);
      }

      const updated = await client.query(
        `UPDATE pending_confirmations
         SET status = 'approved', reviewed_by = $2, reviewed_by_user_id = $3, reviewed_at = now(), result_id = $4
         WHERE id = $1
         RETURNING *`,
        [req.params.id, reviewer.reviewedBy, reviewer.reviewedByUserId, resultId],
      );
      // Approving a pending confirmation IS handling its notification -- no
      // separate manual acknowledge step.
      await client.query(
        `UPDATE notifications SET acknowledged_at = now(), acknowledged_by = $2, acknowledged_by_user_id = $3
         WHERE id = $1 AND acknowledged_at IS NULL`,
        [pc.notification_id, reviewer.reviewedBy, reviewer.reviewedByUserId],
      );

      await client.query("COMMIT");
      res.json(updated.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

confirmationsRouter.patch(
  "/pending-confirmations/:id/reject",
  asyncHandler(async (req, res) => {
    const reviewer = await resolveReviewer(req);
    const { reason } = req.body;

    const existing = await pool.query("SELECT * FROM pending_confirmations WHERE id = $1", [req.params.id]);
    const pc = existing.rows[0];
    if (!pc) throw new HttpError(404, "Pending confirmation not found");
    if (!REVIEWABLE_STATUSES.includes(pc.status)) {
      throw new HttpError(400, "This confirmation has already been reviewed");
    }

    const result = await pool.query(
      `UPDATE pending_confirmations
       SET status = 'rejected', rejection_note = $2, reviewed_by = $3, reviewed_by_user_id = $4, reviewed_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, reason ?? null, reviewer.reviewedBy, reviewer.reviewedByUserId],
    );
    await pool.query(
      `UPDATE notifications SET acknowledged_at = now(), acknowledged_by = $2, acknowledged_by_user_id = $3
       WHERE id = $1 AND acknowledged_at IS NULL`,
      [pc.notification_id, reviewer.reviewedBy, reviewer.reviewedByUserId],
    );

    res.json(result.rows[0]);
  }),
);

// Same "give the submitter a real path back" reasoning as
// spend-records/:id/dispute -- bounded to one round via disputed_at as a
// permanent marker, and re-review happens through the same approve/reject
// routes above (REVIEWABLE_STATUSES), not a separate code path. Only the
// pending_confirmation's own original submitter can dispute it -- checked
// against crew_member_id, never trusted from elsewhere in the body.
confirmationsRouter.patch(
  "/pending-confirmations/:id/dispute",
  asyncHandler(async (req, res) => {
    const { dispute_note, crew_member_id } = req.body;
    if (!dispute_note) throw new HttpError(400, "dispute_note is required");

    const existing = await pool.query("SELECT * FROM pending_confirmations WHERE id = $1", [req.params.id]);
    const pc = existing.rows[0];
    if (!pc) throw new HttpError(404, "Pending confirmation not found");

    if (req.auth?.type === "user") {
      requireAdmin(req);
    } else if (req.auth?.type === "service") {
      if (!crew_member_id) throw new HttpError(400, "crew_member_id is required");
      if (crew_member_id !== pc.crew_member_id) {
        throw new HttpError(403, "Only the crew member this request belongs to can dispute it");
      }
    } else {
      throw new HttpError(403, "Not authorized");
    }

    if (pc.status !== "rejected") throw new HttpError(400, "Only a rejected confirmation can be disputed");
    if (pc.disputed_at) throw new HttpError(400, "This confirmation has already gone through one dispute round");

    // crew_notified_at reset to NULL -- it's already set from the original
    // rejection's delivery, and /pending-confirmations/unnotified only ever
    // looks at that column, not status. Without resetting it, the outcome
    // of the second review would never reach the crew member at all.
    const result = await pool.query(
      `UPDATE pending_confirmations
       SET status = 'disputed', dispute_note = $2, disputed_at = now(), crew_notified_at = NULL
       WHERE id = $1 RETURNING *`,
      [req.params.id, dispute_note],
    );

    await insertNotification(
      pool,
      "critical",
      `A rejected ${pc.action_type.replace(/_/g, " ")} request was disputed and needs a second look: ${dispute_note}`,
      "pending_confirmation_dispute",
      req.params.id,
    );

    res.json(result.rows[0]);
  }),
);

confirmationsRouter.patch(
  "/pending-confirmations/:id/mark-notified",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `UPDATE pending_confirmations SET crew_notified_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!result.rows[0]) throw new HttpError(404, "Pending confirmation not found");
    res.json(result.rows[0]);
  }),
);
