-- Acknowledgment is deliberately separate from resolution (alerts.resolved_at):
-- "I saw this, I'm on it" vs "it's actually fixed". Naming mirrors
-- alerts.resolved_by/resolved_by_user_id exactly (crew vs dashboard-user path).
ALTER TABLE notifications ADD COLUMN acknowledged_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN acknowledged_by UUID REFERENCES crew_members(id);
ALTER TABLE notifications ADD COLUMN acknowledged_by_user_id UUID REFERENCES users(id);

-- Captured opportunistically at delivery time from `openclaw message send
-- --json`, so a later WhatsApp quote-reply can (if the id format lines up --
-- unverified as of this migration) be correlated back to this exact row.
ALTER TABLE notifications ADD COLUMN whatsapp_message_id TEXT;
