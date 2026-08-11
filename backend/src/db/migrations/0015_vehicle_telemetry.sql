CREATE TYPE telemetry_source AS ENUM ('whatsapp_location', 'obd'); -- obd is a future phase, not built for POC

CREATE TABLE vehicle_telemetry (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  source     telemetry_source NOT NULL DEFAULT 'whatsapp_location'
);

CREATE TABLE trips (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     UUID NOT NULL REFERENCES vehicles(id),
  driver_id      UUID NOT NULL REFERENCES crew_members(id),
  purpose_tag    TEXT, -- driver-supplied label, e.g. "dump run", "sod pickup"
  site_id        UUID REFERENCES sites(id),
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ
);
