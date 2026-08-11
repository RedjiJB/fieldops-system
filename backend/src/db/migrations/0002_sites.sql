CREATE TYPE site_type AS ENUM ('job_site', 'depot', 'vendor', 'shop');

CREATE TABLE sites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  address             TEXT,
  type                site_type NOT NULL,
  access_instructions TEXT,
  access_hours        TEXT,
  center_lat          DOUBLE PRECISION,
  center_lng          DOUBLE PRECISION,
  geofence_radius_m   INTEGER,        -- for circular geofences (small residential jobs)
  geofence_polygon    JSONB,          -- for polygon geofences (larger commercial sites)
  active_start        DATE,
  active_end          DATE
);
