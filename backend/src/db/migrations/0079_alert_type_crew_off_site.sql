-- Own migration file, same ALTER TYPE constraint as 0078. Raised by
-- checkCrewLocationStale when a crew member's latest crew_telemetry point
-- is outside their confirmed shift's site geofence -- the person-level
-- counterpart to checkWrongSite's existing vehicle-based wrong_site check.
ALTER TYPE alert_type ADD VALUE 'crew_off_site';
