CREATE TABLE crew_pay_profiles (
  crew_member_id  UUID PRIMARY KEY REFERENCES crew_members(id),
  pay_type        TEXT NOT NULL DEFAULT 'payroll' CHECK (pay_type IN ('payroll', 'cash')),
  hourly_rate     NUMERIC CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id       UUID NOT NULL REFERENCES crew_members(id),
  amount               NUMERIC NOT NULL CHECK (amount > 0),
  paid_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  note                 TEXT,
  recorded_by_user_id  UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
