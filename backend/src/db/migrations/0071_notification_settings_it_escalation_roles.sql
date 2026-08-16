-- Separate from critical_notification_roles (management + owner by
-- default) -- IT-type alerts (connectivity_degraded, disk_space_low,
-- it_issue) should reach the owner specifically ("I get the message"),
-- not broadcast to the whole management group the way ops-critical alerts
-- do. Editable independently from the dashboard's Notification Settings
-- page, same pattern as critical_notification_roles itself.
ALTER TABLE notification_settings ADD COLUMN it_escalation_roles TEXT[] NOT NULL DEFAULT ARRAY['owner'];
