-- Person-level location, deliberately mirroring vehicle_telemetry's exact
-- shape (0015) rather than a different pattern -- same reasoning applies:
-- a crew member sharing live location is passive telemetry, logged as a
-- stream of points, not a single "current location" field. Needed because
-- vehicle_telemetry is keyed to vehicle_id only -- a crew member with no
-- assigned vehicle (or riding as a carpool passenger) has had zero
-- location path until now.
-- address included from the start (unlike vehicle_telemetry, which got it
-- via a later migration, 0021) -- same reverse-geocode-reuse-within-100m
-- behavior from day one.
CREATE TABLE crew_telemetry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id  UUID NOT NULL REFERENCES crew_members(id),
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  source          telemetry_source NOT NULL DEFAULT 'whatsapp_location',
  address         TEXT
);

CREATE INDEX crew_telemetry_crew_member_id_timestamp_idx ON crew_telemetry (crew_member_id, timestamp DESC);
