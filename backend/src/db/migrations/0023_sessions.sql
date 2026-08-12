-- token_hash stores sha256(raw session token), never the raw token itself —
-- same principle as users.password_hash never storing the plaintext password.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
