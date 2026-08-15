-- "Next service due" concept, distinct from the reactive in_maintenance
-- status (which only exists after something's already broken). Calendar
-- interval only -- no usage/mileage/hours tracking exists on assets yet
-- (see docs/DATABASE_SCHEMA.md), so this is deliberately the smaller of
-- two designs, not a placeholder for a bigger one.
ALTER TABLE assets ADD COLUMN service_interval_days INTEGER;
ALTER TABLE assets ADD COLUMN last_serviced_at TIMESTAMPTZ;
