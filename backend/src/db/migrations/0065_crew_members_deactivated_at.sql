-- crew_members has only ever had a boolean `active` flag -- no way to know
-- *when* someone was deactivated/left. Needed for the WhatsApp-history
-- import (past crew members reconstructed from group add/remove system
-- messages, which do have real timestamps). Nullable: current crew members
-- and any future deactivation via the existing PATCH route leave this NULL
-- unless the caller sets it -- this migration doesn't change route behavior,
-- only adds the column.
ALTER TABLE crew_members ADD COLUMN deactivated_at TIMESTAMPTZ;
