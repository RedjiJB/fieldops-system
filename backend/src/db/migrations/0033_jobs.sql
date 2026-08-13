-- A genuine entity, not just a column on shifts -- one site+date+job_type
-- dispatch can span multiple crew members' shifts (the existing "Team 1 /
-- Team 2" multi-team dispatch pattern), and documents.job_id already
-- anticipated something with its own identity (see 0016_documents.sql).
CREATE TYPE job_status AS ENUM ('not_started', 'in_progress', 'complete');

CREATE TABLE jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID NOT NULL REFERENCES sites(id),
  job_type_id  UUID REFERENCES job_types(id),
  date         DATE NOT NULL,
  status       job_status NOT NULL DEFAULT 'not_started',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
