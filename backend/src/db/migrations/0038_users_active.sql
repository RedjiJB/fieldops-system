-- Dashboard accounts could only be created via the interactive CLI script
-- (createUser.ts) with no way to deactivate one without deleting it, which
-- would orphan alerts.resolved_by_user_id/notifications.acknowledged_by_user_id.
-- Same pattern as crew_members.active.
ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
