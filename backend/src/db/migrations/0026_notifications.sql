-- A single event log serving two different consumers: 'critical' rows get
-- pushed to management instantly by a host-side poller (see
-- openclaw/notifier/), 'routine' rows are only ever pulled by the digest
-- agent's list_notifications tool. delivered_at is meaningful only for
-- 'critical' rows (set once pushed) -- it stays NULL forever for 'routine'
-- ones, since those are never pushed at all.
CREATE TYPE notification_priority AS ENUM ('critical', 'routine');

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  priority     notification_priority NOT NULL,
  message      TEXT NOT NULL,
  source_type  TEXT NOT NULL,
  source_id    UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX notifications_pending_idx ON notifications (priority, delivered_at) WHERE delivered_at IS NULL;
