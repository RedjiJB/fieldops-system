-- Populated on PATCH /trips/:id/end by summing haversine distance across
-- vehicle_telemetry points in the trip's time window. NULL (not 0) when
-- fewer than 2 telemetry points fall in that window -- "no data", not "no
-- movement". Telemetry is WhatsApp-share-driven and sparse, so this is a
-- lower-bound distance estimate, not GPS-accurate.
ALTER TABLE trips ADD COLUMN distance_meters DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN duration_seconds INTEGER;
