-- Provenance flag for rows reconstructed from the WhatsApp chat-history
-- import (see backend/src/db/importWhatsappHistory/), as opposed to rows
-- captured live by the system (agent tool calls, dashboard actions). These
-- three tables are the only import targets that represent "this happened"
-- claims rather than static facts (crew_members/sites/vendors from the same
-- import don't need this -- a name or address isn't a claim about an event).
-- NULL means system-captured, real. Any non-NULL value (e.g.
-- 'whatsapp_history_import') means inferred from historical chat text and
-- should never be treated as equivalent to a geofence-verified or
-- agent-logged event -- see the import script's own comments for why.
ALTER TABLE shifts ADD COLUMN import_source TEXT;
ALTER TABLE timeclock_entries ADD COLUMN import_source TEXT;
ALTER TABLE checkouts ADD COLUMN import_source TEXT;
