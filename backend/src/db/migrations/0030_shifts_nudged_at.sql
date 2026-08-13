-- Set by openclaw/notifier/nudge-shifts.mjs after a successful send, so a
-- same-evening cron re-run doesn't double-nudge the same crew member.
ALTER TABLE shifts ADD COLUMN nudged_at TIMESTAMPTZ;
