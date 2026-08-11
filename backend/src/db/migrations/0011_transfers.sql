-- Equipment moving job-to-job directly, without passing back through a depot
CREATE TYPE transfer_status AS ENUM ('requested', 'in_transit', 'completed');

CREATE TABLE transfers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      UUID NOT NULL REFERENCES assets(id),
  from_site_id  UUID NOT NULL REFERENCES sites(id),
  to_site_id    UUID NOT NULL REFERENCES sites(id),
  requested_by  UUID NOT NULL REFERENCES crew_members(id),
  status        transfer_status NOT NULL DEFAULT 'requested',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
