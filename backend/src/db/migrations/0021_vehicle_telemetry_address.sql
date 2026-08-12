-- Reverse-geocoded address for a telemetry point, so the crew/management
-- see "1600 Magic Morning Way" instead of raw lat/lng. Nullable — geocoding
-- is best-effort (external service, can fail/time out) and never blocks
-- logging the coordinates themselves.
ALTER TABLE vehicle_telemetry ADD COLUMN address TEXT;
