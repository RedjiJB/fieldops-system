CREATE TYPE stocking_type AS ENUM ('stocked', 'per_job_delivery');

CREATE TABLE consumables (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  unit                TEXT NOT NULL, -- bag, sqft, cubic_yard, linear_ft, ton
  stocking_type       stocking_type NOT NULL,
  quantity_on_hand    NUMERIC,       -- null/unused for per_job_delivery
  reorder_threshold   NUMERIC,
  preferred_vendor_id UUID REFERENCES vendors(id),
  last_verified_at    TIMESTAMPTZ
);
