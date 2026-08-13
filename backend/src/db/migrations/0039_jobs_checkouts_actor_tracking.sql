-- jobs.status transitions and checkout returns record WHEN but never WHO.
-- Same dual-path convention as alerts.resolved_by/resolved_by_user_id and
-- notifications.acknowledged_by/acknowledged_by_user_id -- crew_members for
-- WhatsApp/agent actors, users for dashboard actors, mutually exclusive.
ALTER TABLE jobs ADD COLUMN started_by UUID REFERENCES crew_members(id);
ALTER TABLE jobs ADD COLUMN started_by_user_id UUID REFERENCES users(id);
ALTER TABLE jobs ADD COLUMN completed_by UUID REFERENCES crew_members(id);
ALTER TABLE jobs ADD COLUMN completed_by_user_id UUID REFERENCES users(id);

ALTER TABLE checkouts ADD COLUMN returned_by UUID REFERENCES crew_members(id);
ALTER TABLE checkouts ADD COLUMN returned_by_user_id UUID REFERENCES users(id);
