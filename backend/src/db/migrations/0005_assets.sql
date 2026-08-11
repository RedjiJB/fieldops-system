CREATE TYPE asset_status AS ENUM ('available', 'checked_out', 'missing', 'in_maintenance', 'unconfirmed', 'retired');

CREATE TABLE assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  qr_tag_id       TEXT UNIQUE NOT NULL,
  purchase_date   DATE,
  condition       TEXT,
  current_site_id UUID REFERENCES sites(id),
  current_holder  UUID REFERENCES crew_members(id),
  status          asset_status NOT NULL DEFAULT 'unconfirmed',
  last_verified_at TIMESTAMPTZ,
  verified_by     UUID REFERENCES crew_members(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
