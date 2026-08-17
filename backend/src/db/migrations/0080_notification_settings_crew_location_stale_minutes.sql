-- Separate from vehicle telemetry's STALE_TELEMETRY_MINUTES constant --
-- a person's phone going quiet for a while is a different tolerance than
-- a vehicle's OBD/location feed going quiet, and this one needed to be
-- dashboard-editable from day one rather than hardcoded, same reasoning
-- as every other *_roles/*_minutes notification setting already here.
-- 90 min default: long enough that a normal lunch break or a dead zone
-- on a rural site doesn't fire an alert, short enough to still catch a
-- real problem within the same shift.
ALTER TABLE notification_settings ADD COLUMN crew_location_stale_minutes INTEGER NOT NULL DEFAULT 90;
