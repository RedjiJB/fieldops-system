-- Same idempotency pattern as 0030's nudged_at, for the new 1-hour-before
-- reminder (openclaw/notifier/shift-reminder.mjs) -- a separate column
-- because this is a distinct notification (evening-before confirm/decline
-- ask vs. the day-of "starting soon" heads-up), not a state to reuse.
ALTER TABLE shifts ADD COLUMN reminder_sent_at TIMESTAMPTZ;
