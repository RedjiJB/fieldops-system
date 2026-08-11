CREATE TYPE alert_type AS ENUM ('idle', 'delay', 'wrong_site', 'order_stalled', 'loadout_gap', 'overdue');

CREATE TABLE alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type              alert_type NOT NULL,
  site_id           UUID REFERENCES sites(id),
  related_record_id UUID, -- polymorphic reference to the order/checkout/shift/etc. that triggered it
  raised_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID REFERENCES crew_members(id)
);
