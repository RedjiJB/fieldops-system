CREATE TYPE order_status AS ENUM ('requested', 'confirmed', 'picked', 'loaded', 'in_field', 'returned');

CREATE TABLE orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID NOT NULL REFERENCES crew_members(id),
  site_id       UUID REFERENCES sites(id),
  date_needed   DATE,
  status        order_status NOT NULL DEFAULT 'requested',
  spec_notes    TEXT, -- free text for brand/color/dimension specs
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  asset_id      UUID REFERENCES assets(id),
  consumable_id UUID REFERENCES consumables(id),
  quantity      NUMERIC NOT NULL
);
