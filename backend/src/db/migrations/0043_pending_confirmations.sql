CREATE TABLE pending_confirmations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type          TEXT NOT NULL CHECK (action_type IN ('timeclock_event', 'consumable_adjustment', 'checkout_return', 'mileage_claim')),
  summary              TEXT NOT NULL,
  payload              JSONB NOT NULL,
  crew_member_id       UUID NOT NULL REFERENCES crew_members(id),
  status               TEXT NOT NULL DEFAULT 'awaiting_management' CHECK (status IN ('awaiting_management', 'approved', 'rejected', 'expired')),
  notification_id      UUID NOT NULL REFERENCES notifications(id),
  reviewed_by_user_id  UUID REFERENCES users(id),
  reviewed_at          TIMESTAMPTZ,
  result_id            UUID,
  crew_notified_at     TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
