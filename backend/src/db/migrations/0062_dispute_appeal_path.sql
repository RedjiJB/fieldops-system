-- A rejected spend_records/pending_confirmations row was previously
-- terminal -- no reason captured, no way for the crew member it affects to
-- respond. This adds a reason at reject time and a bounded, one-round
-- dispute: the crew member can contest a rejection once, which puts it
-- back in front of management (via the *same* approve/reject routes,
-- guards widened below) rather than reopening indefinitely.
--
-- 'disputed' deliberately isn't a return to 'pending'/'awaiting_management'
-- -- collapsing back to the original state would erase the fact a
-- rejection happened and was contested, which is exactly the trail this
-- feature exists to keep visible.
ALTER TABLE spend_records DROP CONSTRAINT spend_records_status_check;
ALTER TABLE spend_records ADD CONSTRAINT spend_records_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'disputed'));
ALTER TABLE spend_records ADD COLUMN rejection_note TEXT;
ALTER TABLE spend_records ADD COLUMN dispute_note TEXT;
ALTER TABLE spend_records ADD COLUMN disputed_at TIMESTAMPTZ;

ALTER TABLE pending_confirmations DROP CONSTRAINT pending_confirmations_status_check;
ALTER TABLE pending_confirmations ADD CONSTRAINT pending_confirmations_status_check
  CHECK (status IN ('awaiting_management', 'approved', 'rejected', 'expired', 'disputed'));
ALTER TABLE pending_confirmations ADD COLUMN rejection_note TEXT;
ALTER TABLE pending_confirmations ADD COLUMN dispute_note TEXT;
ALTER TABLE pending_confirmations ADD COLUMN disputed_at TIMESTAMPTZ;
