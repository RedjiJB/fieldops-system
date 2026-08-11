CREATE TYPE po_status AS ENUM ('compiled', 'sent_to_office', 'forwarded_by_office', 'fulfilled');

CREATE TABLE purchase_orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id  UUID REFERENCES vendors(id),
  status     po_status NOT NULL DEFAULT 'compiled',
  cost       NUMERIC,
  eta        DATE,
  sent_to    TEXT, -- info@thesodboys.ca, or a specific picker's contact
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description       TEXT NOT NULL, -- free text; may include full brand/spec
  quantity          NUMERIC
);
