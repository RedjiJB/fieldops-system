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
): Promise<void> {
  await db.query(
    `INSERT INTO notifications (priority, message, source_type, source_id) VALUES ($1, $2, $3, $4)`,
    [priority, message, sourceType, sourceId],
  );
}
