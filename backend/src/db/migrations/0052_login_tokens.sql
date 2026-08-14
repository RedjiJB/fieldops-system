-- Redeem table for the WhatsApp magic-link login flow -- a crew member
-- texts the agent, the agent calls POST /auth/login-token to mint one of
-- these, sends the resulting link over WhatsApp, and GET /auth/redeem
-- exchanges it for a real session (see backend/src/lib/session.ts). Short
-- expiry (15 min, enforced in application code) and single-use (used_at)
-- bound the interception window -- the resulting *session* still lasts the
-- same 30 days any dashboard login does, same risk profile as a leaked
-- session cookie today, not a new class of exposure.
CREATE TABLE login_tokens (
  token_hash     TEXT PRIMARY KEY,
  crew_member_id UUID NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);
