ALTER TABLE pending_confirmations ADD COLUMN reviewed_by UUID REFERENCES crew_members(id);

-- A mileage claim approved via WhatsApp (management crew member, not a
-- dashboard user) has no users.id to put here -- same dual-path convention
-- as everywhere else now extends to spend_records.
ALTER TABLE spend_records ALTER COLUMN submitted_by_user_id DROP NOT NULL;
ALTER TABLE spend_records ADD COLUMN submitted_by UUID REFERENCES crew_members(id);
ALTER TABLE spend_records ADD COLUMN reviewed_by UUID REFERENCES crew_members(id);
