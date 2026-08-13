ALTER TABLE order_items ADD COLUMN unit_cost NUMERIC CHECK (unit_cost IS NULL OR unit_cost >= 0);

CREATE TABLE money_instruments (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type    TEXT NOT NULL CHECK (type IN ('company_card', 'petty_cash')),
  label   TEXT NOT NULL,
  balance NUMERIC, -- petty_cash only; null/unused for company_card
  active  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE money_instrument_custody (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id        UUID NOT NULL REFERENCES money_instruments(id),
  held_by              UUID NOT NULL REFERENCES crew_members(id),
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at             TIMESTAMPTZ,
  assigned_by_user_id  UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE spend_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category              TEXT NOT NULL,
  method                TEXT NOT NULL CHECK (method IN ('cash', 'company_card', 'personal_reimbursed')),
  status                TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  amount                NUMERIC CHECK (amount IS NULL OR amount >= 0),
  distance_km           NUMERIC CHECK (distance_km IS NULL OR distance_km >= 0),
  rate_per_km           NUMERIC CHECK (rate_per_km IS NULL OR rate_per_km >= 0),
  description           TEXT,
  document_id           UUID REFERENCES documents(id),
  instrument_id         UUID REFERENCES money_instruments(id),
  crew_member_id        UUID REFERENCES crew_members(id),
  submitted_by_user_id  UUID NOT NULL REFERENCES users(id),
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by_user_id   UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
