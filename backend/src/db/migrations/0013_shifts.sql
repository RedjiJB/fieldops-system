CREATE TYPE shift_status AS ENUM ('assigned', 'confirmed', 'no_show');

CREATE TABLE shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id  UUID NOT NULL REFERENCES crew_members(id),
  site_id         UUID NOT NULL REFERENCES sites(id),
  date            DATE NOT NULL,
  start_time      TIME,
  end_time        TIME,
  status          shift_status NOT NULL DEFAULT 'assigned'
);
