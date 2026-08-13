import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const activityRouter = Router();

const DEFAULT_LIMIT = 100;

// One event shape (event_type, occurred_at, actor_name, description) per
// branch, unioned across every table that already carries an actor +
// timestamp. orders/purchase_orders have no actor column yet, so their
// transitions don't appear here -- see the plan's scope note.
const EVENTS_QUERY = `
  WITH events AS (
    SELECT 'job_started' AS event_type, j.started_at AS occurred_at,
           COALESCE(cm.name, u.name) AS actor_name,
           'Job started at ' || COALESCE(s.name, 'unknown site')
             || CASE WHEN jt.name IS NOT NULL THEN ' (' || jt.name || ')' ELSE '' END AS description
    FROM jobs j
    LEFT JOIN sites s ON s.id = j.site_id
    LEFT JOIN job_types jt ON jt.id = j.job_type_id
    LEFT JOIN crew_members cm ON cm.id = j.started_by
    LEFT JOIN users u ON u.id = j.started_by_user_id
    WHERE j.started_at IS NOT NULL

    UNION ALL
    SELECT 'job_completed', j.completed_at,
           COALESCE(cm.name, u.name),
           'Job completed at ' || COALESCE(s.name, 'unknown site')
             || CASE WHEN jt.name IS NOT NULL THEN ' (' || jt.name || ')' ELSE '' END
    FROM jobs j
    LEFT JOIN sites s ON s.id = j.site_id
    LEFT JOIN job_types jt ON jt.id = j.job_type_id
    LEFT JOIN crew_members cm ON cm.id = j.completed_by
    LEFT JOIN users u ON u.id = j.completed_by_user_id
    WHERE j.completed_at IS NOT NULL

    UNION ALL
    SELECT 'checkout_created', c.checked_out_at,
           cm.name,
           'Checked out ' || a.name
    FROM checkouts c
    JOIN assets a ON a.id = c.asset_id
    LEFT JOIN crew_members cm ON cm.id = c.checked_out_by
    WHERE c.checked_out_at IS NOT NULL

    UNION ALL
    SELECT 'checkout_returned', c.checked_in_at,
           COALESCE(cm.name, u.name),
           'Returned ' || a.name || CASE WHEN c.damage_flag THEN ' (damaged)' ELSE '' END
    FROM checkouts c
    JOIN assets a ON a.id = c.asset_id
    LEFT JOIN crew_members cm ON cm.id = c.returned_by
    LEFT JOIN users u ON u.id = c.returned_by_user_id
    WHERE c.checked_in_at IS NOT NULL

    UNION ALL
    SELECT 'asset_verified', a.last_verified_at,
           cm.name,
           'Verified ' || a.name
    FROM assets a
    LEFT JOIN crew_members cm ON cm.id = a.verified_by
    WHERE a.last_verified_at IS NOT NULL

    UNION ALL
    SELECT 'alert_resolved', al.resolved_at,
           COALESCE(cm.name, u.name),
           'Resolved ' || al.type::text || ' alert'
    FROM alerts al
    LEFT JOIN crew_members cm ON cm.id = al.resolved_by
    LEFT JOIN users u ON u.id = al.resolved_by_user_id
    WHERE al.resolved_at IS NOT NULL

    UNION ALL
    SELECT 'notification_acknowledged', n.acknowledged_at,
           COALESCE(cm.name, u.name),
           n.message
    FROM notifications n
    LEFT JOIN crew_members cm ON cm.id = n.acknowledged_by
    LEFT JOIN users u ON u.id = n.acknowledged_by_user_id
    WHERE n.acknowledged_at IS NOT NULL

    UNION ALL
    SELECT 'document_uploaded', d.uploaded_at,
           cm.name,
           'Uploaded ' || d.filename
    FROM documents d
    LEFT JOIN crew_members cm ON cm.id = d.uploaded_by
    WHERE d.uploaded_at IS NOT NULL
  )
  SELECT * FROM events
  WHERE ($1::text IS NULL OR event_type = $1)
    AND ($2::timestamptz IS NULL OR occurred_at >= $2)
  ORDER BY occurred_at DESC
  LIMIT $3
`;

activityRouter.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const { event_type, since, limit } = req.query;
    const result = await pool.query(EVENTS_QUERY, [
      event_type ?? null,
      since ?? null,
      limit ? Number(limit) : DEFAULT_LIMIT,
    ]);
    res.json(result.rows);
  }),
);
