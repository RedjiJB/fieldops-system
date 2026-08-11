-- EXCEPTION_HANDLING.md's overdue-equipment check compares expected return
-- against current time, but checkouts never had a column for it. Adding it here.
ALTER TABLE checkouts ADD COLUMN expected_return_at TIMESTAMPTZ;
