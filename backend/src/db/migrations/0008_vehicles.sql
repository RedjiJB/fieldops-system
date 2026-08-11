CREATE TABLE vehicles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate            TEXT UNIQUE NOT NULL,
  assigned_crew_id UUID REFERENCES crew_members(id),
  current_mileage  NUMERIC
);
