-- Agent-facing language preference (Ottawa is bilingual) -- the agent
-- converses in this language once known, but nothing else in the system
-- translates on it: dashboard UI and system-generated WhatsApp notification
-- templates (alerts, etc.) stay English-only for this pass. NULL means no
-- preference set, current English-only behavior.
ALTER TABLE crew_members ADD COLUMN preferred_language TEXT;
