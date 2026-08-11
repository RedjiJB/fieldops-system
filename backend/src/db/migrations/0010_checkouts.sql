CREATE TABLE checkouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id       UUID NOT NULL REFERENCES assets(id),
  order_id       UUID REFERENCES orders(id),
  checked_out_by UUID NOT NULL REFERENCES crew_members(id),
  checked_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_at  TIMESTAMPTZ,
  damage_flag    BOOLEAN NOT NULL DEFAULT false,
  damage_note    TEXT,
  photo_url      TEXT
);
