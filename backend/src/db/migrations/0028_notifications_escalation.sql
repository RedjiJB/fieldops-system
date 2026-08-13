-- Tracks re-sends of a critical notification that's been delivered but
-- never acknowledged -- see openclaw/notifier/deliver-notifications.mjs's
-- escalation pass and GET /notifications/escalation-candidates.
ALTER TABLE notifications ADD COLUMN escalated_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN last_escalated_at TIMESTAMPTZ;
