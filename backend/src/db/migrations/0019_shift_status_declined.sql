-- API.md's shift-confirm endpoint says crew can "confirm or decline", but
-- shift_status never had a value for a decline. Adding it here.
ALTER TYPE shift_status ADD VALUE 'declined';
