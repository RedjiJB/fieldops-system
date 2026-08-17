-- Carpool, request-based: a crew member posts they need a ride or can
-- offer one, someone (crew or management) matches a need to an offer.
-- Deliberately no auto-matching logic here -- matched_request_id is only
-- ever set by a human decision via PATCH /ride-requests/:id/match, never
-- computed. site_id nullable since a "need a ride" post might not know
-- the exact site yet, just a date; seats_available only meaningful for
-- an 'offering_ride' row.
CREATE TABLE ride_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id       UUID NOT NULL REFERENCES crew_members(id),
  request_type         TEXT NOT NULL CHECK (request_type IN ('need_ride', 'offering_ride')),
  date                 DATE NOT NULL,
  site_id              UUID REFERENCES sites(id),
  seats_available      INTEGER CHECK (seats_available IS NULL OR seats_available > 0),
  notes                TEXT,
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'cancelled')),
  matched_request_id   UUID REFERENCES ride_requests(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ride_requests_status_date_idx ON ride_requests (status, date);
