-- Dashboard users resolving an alert have no crew_members row (separate
-- identity system), so they can't use the existing resolved_by FK.
-- Nullable — set only when a dashboard user resolves it; resolved_by (crew)
-- stays the path for agent-driven resolutions.
ALTER TABLE alerts ADD COLUMN resolved_by_user_id UUID REFERENCES users(id);
