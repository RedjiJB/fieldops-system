-- Nullable -- a shift can exist without a job exactly as before; a job only
-- gets created when a dispatch message actually identifies a job type.
ALTER TABLE shifts ADD COLUMN job_id UUID REFERENCES jobs(id);
