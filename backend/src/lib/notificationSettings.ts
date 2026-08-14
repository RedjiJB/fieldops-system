import type { Pool, PoolClient } from "pg";

// Single-row table, same convention as dashboard_url -- no id, no WHERE
// clause, just SELECT ... LIMIT 1 / bare UPDATE. Read fresh every time
// rather than cached in memory, since the whole point is that an admin can
// change these from the dashboard and have the very next exceptions-worker
// tick or notifier cron pick it up, not wait for a restart.
export type NotificationSettings = {
  escalation_threshold_minutes: number;
  max_escalations: number;
  vehicle_dark_critical: boolean;
  critical_notification_roles: string[];
  order_stall_hours: number;
  idle_hours: number;
  delay_buffer_minutes: number;
  rain_probability_threshold: number;
  wind_speed_threshold_kmh: number;
  updated_at: string;
};

export async function getNotificationSettings(client: Pool | PoolClient): Promise<NotificationSettings> {
  const result = await client.query("SELECT * FROM notification_settings LIMIT 1");
  return result.rows[0];
}
