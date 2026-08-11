CREATE TABLE vendors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  contact_method  TEXT, -- email, phone
  contact_address TEXT,
  account_number  TEXT,
  lead_time_days  INTEGER
);
