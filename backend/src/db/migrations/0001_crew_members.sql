CREATE TABLE crew_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  phone       TEXT UNIQUE NOT NULL, -- WhatsApp identity
  role        TEXT NOT NULL DEFAULT 'crew', -- crew, crew_lead, yard, management
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
