CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID, -- references a future jobs table if one is split out from sites
  site_id      UUID REFERENCES sites(id),
  type         TEXT NOT NULL, -- contract, permit, photo, receipt, disposal_ticket, insurance_cert
  filename     TEXT NOT NULL,
  uploaded_by  UUID REFERENCES crew_members(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  tags         TEXT[],
  expiry_date  DATE
);
