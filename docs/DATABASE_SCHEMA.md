# Database Schema

Postgres 16. This is the reference schema — the actual migration files will live in `backend/migrations/` once the backend is built (see [ROADMAP.md](ROADMAP.md)).

## assets

Durable equipment — compactors, saws, trailers, hand tools. Every asset gets a QR tag.

```sql
CREATE TYPE asset_status AS ENUM ('available', 'checked_out', 'missing', 'in_maintenance', 'unconfirmed', 'retired');

CREATE TABLE assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  qr_tag_id       TEXT UNIQUE NOT NULL,
  purchase_date   DATE,
  condition       TEXT,
  current_site_id UUID REFERENCES sites(id),
  current_holder  UUID REFERENCES crew_members(id),
  status          asset_status NOT NULL DEFAULT 'unconfirmed',
  last_verified_at TIMESTAMPTZ,
  verified_by     UUID REFERENCES crew_members(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Rule enforced at the application layer, not just the DB**: the loadout engine never assigns an asset where `status != 'available'` or `last_verified_at IS NULL`.

## consumables

Materials — some stocked (bagged goods with a reorder threshold), some ordered fresh per job (bulk landscape materials like sod or topsoil).

```sql
CREATE TYPE stocking_type AS ENUM ('stocked', 'per_job_delivery');

CREATE TABLE consumables (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  unit                TEXT NOT NULL, -- bag, sqft, cubic_yard, linear_ft, ton
  stocking_type       stocking_type NOT NULL,
  quantity_on_hand    NUMERIC,       -- null/unused for per_job_delivery
  reorder_threshold   NUMERIC,
  preferred_vendor_id UUID REFERENCES vendors(id),
  last_verified_at    TIMESTAMPTZ
);
```

## sites

Job sites, depots (like Access Storage), vendor locations, and the shop.

```sql
CREATE TYPE site_type AS ENUM ('job_site', 'depot', 'vendor', 'shop');

CREATE TABLE sites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  address             TEXT,
  type                site_type NOT NULL,
  access_instructions TEXT,
  access_hours        TEXT,
  center_lat          DOUBLE PRECISION,
  center_lng          DOUBLE PRECISION,
  geofence_radius_m   INTEGER,        -- for circular geofences (small residential jobs)
  geofence_polygon    JSONB,          -- for polygon geofences (larger commercial sites)
  active_start        DATE,
  active_end          DATE
);
```

## job_types

```sql
CREATE TABLE job_types (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL
  -- seed values: interlock_repair, interlock_full_install, sod_install,
  -- sod_replacement, irrigation_service, seed_and_feed, service_call, excavation
);
```

## loadouts / loadout_items

Named kits per job type. Quantities can scale per crew member.

```sql
CREATE TABLE loadouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  job_type_id UUID REFERENCES job_types(id)
);

CREATE TABLE loadout_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loadout_id     UUID NOT NULL REFERENCES loadouts(id) ON DELETE CASCADE,
  asset_id       UUID REFERENCES assets(id),
  consumable_id  UUID REFERENCES consumables(id),
  quantity       NUMERIC NOT NULL,
  scales_with_crew BOOLEAN NOT NULL DEFAULT false,
  CHECK (
    (asset_id IS NOT NULL AND consumable_id IS NULL) OR
    (asset_id IS NULL AND consumable_id IS NOT NULL)
  )
);
```

## jobs

A genuine entity, not just a column on `shifts` — one site+date+job_type dispatch can span multiple crew members' shifts (the "Team 1 / Team 2" multi-team dispatch pattern), and `documents.job_id` below anticipated something with its own identity from early on. Only created when a dispatch message actually identifies a job type — a shift without one behaves exactly as before this existed.

```sql
CREATE TYPE job_status AS ENUM ('not_started', 'in_progress', 'complete');

CREATE TABLE jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID NOT NULL REFERENCES sites(id),
  job_type_id  UUID REFERENCES job_types(id),
  date         DATE NOT NULL,
  status       job_status NOT NULL DEFAULT 'not_started', -- manual transitions only; auto-transition on geofence arrival is future work
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`shifts.job_id UUID REFERENCES jobs(id)` (nullable) links a shift to one.

## orders / checkouts / transfers

```sql
CREATE TYPE order_status AS ENUM ('requested', 'confirmed', 'picked', 'loaded', 'in_field', 'returned');

CREATE TABLE orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID NOT NULL REFERENCES crew_members(id),
  site_id       UUID REFERENCES sites(id),
  date_needed   DATE,
  status        order_status NOT NULL DEFAULT 'requested',
  spec_notes    TEXT, -- free text for brand/color/dimension specs
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  asset_id      UUID REFERENCES assets(id),
  consumable_id UUID REFERENCES consumables(id),
  quantity      NUMERIC NOT NULL
);

CREATE TABLE checkouts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           UUID NOT NULL REFERENCES assets(id),
  order_id           UUID REFERENCES orders(id),
  checked_out_by     UUID NOT NULL REFERENCES crew_members(id),
  checked_out_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_return_at TIMESTAMPTZ, -- what EXCEPTION_HANDLING.md's overdue check compares against
  checked_in_at      TIMESTAMPTZ,
  damage_flag        BOOLEAN NOT NULL DEFAULT false,
  damage_note        TEXT,
  photo_url          TEXT
);

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
```

## vendors / purchase_orders

No API integration in this phase, deliberately — see [ARCHITECTURE.md](ARCHITECTURE.md).

```sql
CREATE TABLE vendors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  contact_method  TEXT, -- email, phone
  contact_address TEXT,
  account_number  TEXT,
  lead_time_days  INTEGER
);

CREATE TYPE po_status AS ENUM ('compiled', 'sent_to_office', 'forwarded_by_office', 'fulfilled');

CREATE TABLE purchase_orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id  UUID REFERENCES vendors(id),
  order_id   UUID REFERENCES orders(id), -- which order this was compiled from; nullable, added in 0037, pre-migration rows have none
  status     po_status NOT NULL DEFAULT 'compiled',
  cost       NUMERIC,
  eta        DATE,
  sent_to    TEXT, -- info@thesodboys.ca, or a specific picker's contact
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description       TEXT NOT NULL, -- free text; may include full brand/spec
  quantity          NUMERIC
);
```

## crew_members / shifts / timeclock_entries

```sql
CREATE TABLE crew_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  phone       TEXT UNIQUE NOT NULL, -- WhatsApp identity
  role        TEXT NOT NULL DEFAULT 'crew', -- crew, crew_lead, yard, management
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE shift_status AS ENUM ('assigned', 'confirmed', 'declined', 'no_show'); -- 'declined' covers the API's confirm-or-decline flow

CREATE TABLE shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id  UUID NOT NULL REFERENCES crew_members(id),
  site_id         UUID NOT NULL REFERENCES sites(id),
  date            DATE NOT NULL,
  start_time      TIME,
  end_time        TIME,
  status          shift_status NOT NULL DEFAULT 'assigned',
  nudged_at       TIMESTAMPTZ, -- set by openclaw/notifier/nudge-shifts.mjs once a confirm/decline reminder is sent, so a same-evening cron re-run doesn't double-nudge
  job_id          UUID REFERENCES jobs(id) -- nullable; only set when the dispatch message identified a job type
);

CREATE TYPE timeclock_event AS ENUM ('in', 'break_start', 'break_end', 'out');

CREATE TABLE timeclock_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id    UUID NOT NULL REFERENCES crew_members(id),
  event_type        timeclock_event NOT NULL,
  site_id           UUID REFERENCES sites(id),
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT now(),
  geofence_verified BOOLEAN NOT NULL DEFAULT false
);
```

## vehicles / vehicle_telemetry / trips

```sql
CREATE TABLE vehicles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate            TEXT UNIQUE NOT NULL,
  assigned_crew_id UUID REFERENCES crew_members(id),
  current_mileage  NUMERIC
);

CREATE TYPE telemetry_source AS ENUM ('whatsapp_location', 'obd'); -- obd is a future phase, not built for POC

CREATE TABLE vehicle_telemetry (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  source     telemetry_source NOT NULL DEFAULT 'whatsapp_location',
  address    TEXT -- reverse-geocoded via OpenStreetMap Nominatim (best-effort, nullable — geocoding failures never block logging lat/lng)
);

CREATE TABLE trips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       UUID NOT NULL REFERENCES vehicles(id),
  driver_id        UUID NOT NULL REFERENCES crew_members(id),
  purpose_tag      TEXT, -- driver-supplied label, e.g. "dump run", "sod pickup"
  site_id          UUID REFERENCES sites(id),
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  distance_meters  DOUBLE PRECISION, -- summed haversine across vehicle_telemetry in the trip window; NULL (not 0) when <2 points exist
  duration_seconds INTEGER -- ended_at - started_at, set alongside distance_meters when the trip closes
);
```

## documents

```sql
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID REFERENCES jobs(id), -- was a bare unconstrained UUID from 0016_documents.sql until 0035_documents_job_fk.sql wired up the FK once jobs existed
  site_id      UUID REFERENCES sites(id),
  type         TEXT NOT NULL, -- contract, permit, photo, receipt, disposal_ticket, insurance_cert
  filename     TEXT NOT NULL, -- human-readable original filename
  storage_path TEXT, -- internal generated filename on disk (backend/uploads); null if this row is metadata-only with no stored file
  mime_type    TEXT, -- needed to serve the file with the right Content-Type
  uploaded_by  UUID REFERENCES crew_members(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  tags         TEXT[],
  expiry_date  DATE
);
```

## alerts

The exceptions engine's output — see [EXCEPTION_HANDLING.md](EXCEPTION_HANDLING.md). This table doesn't own operational data; it watches for deviations elsewhere and raises flags.

```sql
CREATE TYPE alert_type AS ENUM ('idle', 'delay', 'wrong_site', 'order_stalled', 'loadout_gap', 'overdue', 'vehicle_dark', 'weather');

CREATE TABLE alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                alert_type NOT NULL,
  site_id             UUID REFERENCES sites(id),
  related_record_id   UUID, -- polymorphic reference to the order/checkout/shift/etc. that triggered it
  raised_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES crew_members(id), -- set when a crew member/agent turn resolves it
  resolved_by_user_id UUID REFERENCES users(id) -- set when a dashboard user resolves it; mutually exclusive with resolved_by
);
```

## notifications

A single event log feeding two consumers: `critical` rows get pushed to management on WhatsApp within a minute by `openclaw/notifier/`; `routine` rows are only ever pulled by the digest agent's `list_notifications` tool. `message` is pre-formatted, human-readable text set by whichever backend code inserted the row (asset status changes, newly-raised alerts, order status changes) — this table has no writer-facing REST endpoint, only reader/delivery/acknowledgment endpoints (see [API.md](API.md)).

Acknowledgment (`acknowledged_at`/`acknowledged_by`/`acknowledged_by_user_id`) is deliberately separate from `alerts.resolved_at` — "a human has seen this and is on it" vs. "the underlying problem is actually fixed." Escalation (`escalated_count`/`last_escalated_at`) tracks re-sends of a critical notification nobody's acknowledged yet, capped at 3.

```sql
CREATE TYPE notification_priority AS ENUM ('critical', 'routine');

CREATE TABLE notifications (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  priority               notification_priority NOT NULL,
  message                TEXT NOT NULL,
  source_type            TEXT NOT NULL, -- 'asset' | 'alert' | 'order'
  source_id              UUID, -- polymorphic, like alerts.related_record_id
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at           TIMESTAMPTZ, -- only ever set for 'critical' rows; stays NULL forever for 'routine' ones
  acknowledged_at        TIMESTAMPTZ,
  acknowledged_by        UUID REFERENCES crew_members(id), -- set when acknowledged via WhatsApp/agent
  acknowledged_by_user_id UUID REFERENCES users(id), -- set when acknowledged via the dashboard
  whatsapp_message_id    TEXT, -- captured at delivery, for matching a later quote-reply back to this row (see AGENTS.md)
  escalated_count        INTEGER NOT NULL DEFAULT 0,
  last_escalated_at      TIMESTAMPTZ
);
```

## Dashboard auth

`users`/`sessions` back the web dashboard's login — entirely separate from `crew_members`, which is the WhatsApp/agent-side identity model. No `role` column on `users` yet; every dashboard account sees the same thing (map view only, in v1).

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true, -- added in 0038; deactivated accounts keep their row (FKs from alerts/notifications)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  -- still no role/permission column -- every logged-in user has identical access (see API.md's Users section)
);

-- token_hash stores sha256(raw token), never the raw token — same principle
-- as password_hash never storing the plaintext password.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
```

## Entity relationship summary

```
crew_members ──< shifts >── sites
     │                         │
     ├──< timeclock_entries ──┘
     ├──< checkouts ──> assets ──> loadout_items ──< loadouts >── job_types
     ├──< orders ──< order_items ──> assets/consumables
     ├──< trips ──> vehicles ──< vehicle_telemetry
     └──< documents

orders ──> purchase_orders ──> vendors
alerts ──> (polymorphic: orders, checkouts, shifts, sites)
```
