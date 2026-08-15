-- Configurable thresholds for the overtime/missed-break flags computed on
-- timeclock sessions -- see backend/src/lib/timeclock.ts's computeSessions.
-- Same table as every other operational threshold (order_stall_hours,
-- idle_hours, etc.), despite the table's name -- established precedent,
-- not a new pattern.
ALTER TABLE notification_settings ADD COLUMN daily_overtime_hours INTEGER NOT NULL DEFAULT 8;
ALTER TABLE notification_settings ADD COLUMN break_required_after_hours INTEGER NOT NULL DEFAULT 5;
