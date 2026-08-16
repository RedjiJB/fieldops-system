-- Nullable, per-notification override of who a critical notification goes
-- to -- until now every critical notification broadcast uniformly to
-- notification_settings.critical_notification_roles with no way to route
-- a specific alert type differently. NULL (the default, unaffected for
-- every existing call site) means "use critical_notification_roles as
-- before". Non-NULL means deliver-notifications.mjs queries these roles
-- instead. First use: IT-type alerts routing to it_escalation_roles
-- (owner) rather than the broader management group -- see raiseAlert's
-- and insertNotification's new recipientRolesOverride parameter.
ALTER TABLE notifications ADD COLUMN recipient_roles_override TEXT[];
