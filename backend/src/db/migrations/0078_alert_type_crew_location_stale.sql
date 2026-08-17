-- Own migration file: ALTER TYPE ... ADD VALUE can't share a transaction
-- with other statements. Raised by checkCrewLocationStale (exceptions.ts)
-- when a crew member on a confirmed shift today hasn't sent a live-location
-- ping in crew_location_stale_minutes -- the person-level counterpart to
-- the existing vehicle-telemetry staleness check, now that crew_telemetry
-- (0075) gives a person their own location stream independent of any
-- assigned vehicle.
ALTER TYPE alert_type ADD VALUE 'crew_location_stale';
