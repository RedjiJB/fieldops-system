import type { Pool, PoolClient } from "pg";

export type NotificationPriority = "critical" | "routine";

// Same shape whether called with the shared pool or a transaction client
// (assets.ts/orders.ts use pool.query directly; exceptions.ts/transfers use
// a client inside a transaction) -- both satisfy this minimal query surface.
type Queryable = Pick<Pool | PoolClient, "query">;

export async function insertNotification(
  db: Queryable,
  priority: NotificationPriority,
  message: string,
  sourceType: string,
  sourceId: string | null,
  // NULL (omitted) means "use notification_settings.critical_notification_roles
  // as always" -- only set this when a specific source needs a different
  // audience than the default critical broadcast (e.g. IT-type alerts
  // routing to it_escalation_roles instead). See deliver-notifications.mjs's
  // getRecipients(), which checks this per-notification.
  recipientRolesOverride?: string[],
): Promise<string> {
  const result = await db.query(
    `INSERT INTO notifications (priority, message, source_type, source_id, recipient_roles_override) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [priority, message, sourceType, sourceId, recipientRolesOverride ?? null],
  );
  return result.rows[0].id;
}
