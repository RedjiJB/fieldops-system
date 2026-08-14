-- Dual-path identity for sessions, same convention used everywhere else in
-- this schema -- a session now belongs to either a dashboard user (email +
-- password login) or a crew member (WhatsApp magic-link login, see
-- 0052_login_tokens.sql), never both, never neither. crew_members has no
-- FK to users and never will -- this is a second, parallel session type,
-- not a merge of the two identity systems.
ALTER TABLE sessions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE sessions ADD COLUMN crew_member_id UUID REFERENCES crew_members(id) ON DELETE CASCADE;
ALTER TABLE sessions ADD CONSTRAINT sessions_exactly_one_identity
  CHECK ((user_id IS NOT NULL) != (crew_member_id IS NOT NULL));
