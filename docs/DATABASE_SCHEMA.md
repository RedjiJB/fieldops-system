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
  started_by            UUID REFERENCES crew_members(id), -- added in 0039; mutually exclusive with started_by_user_id
  started_by_user_id    UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  completed_by          UUID REFERENCES crew_members(id), -- added in 0039; mutually exclusive with completed_by_user_id
  completed_by_user_id  UUID REFERENCES users(id),
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
  quantity      NUMERIC NOT NULL,
  unit_cost     NUMERIC -- added in 0042; the real price paid for this specific transaction, not a static per-consumable field -- see API.md's GET /consumables/:id/price-history
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
  photo_url          TEXT,
  returned_by         UUID REFERENCES crew_members(id), -- added in 0039; mutually exclusive with returned_by_user_id
  returned_by_user_id UUID REFERENCES users(id)
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

`GET /documents/expiring` (expiry of a document that exists) and `GET /spend-records/missing-receipts` (absence — no document at all for a spend that should have one, see [Spending](#spending) below) are two separate, non-overlapping checks against this table and `spend_records.document_id` respectively — no schema change needed for either.

`type` was never changeable after creation until `PATCH /documents/:id` (see [API.md](API.md)) — every inbound WhatsApp photo is still auto-filed instantly as `type='photo'` (unchanged), but an agent turn can now call `classify_document` to upgrade it to `receipt`/`permit`/`contract`/`insurance_cert`/`disposal_ticket` once the image content makes that clear. See [ARCHITECTURE.md](ARCHITECTURE.md) for the classification flow.

## alerts

The exceptions engine's output — see [EXCEPTION_HANDLING.md](EXCEPTION_HANDLING.md). This table doesn't own operational data; it watches for deviations elsewhere and raises flags.

```sql
CREATE TYPE alert_type AS ENUM ('idle', 'delay', 'wrong_site', 'order_stalled', 'loadout_gap', 'overdue', 'vehicle_dark', 'weather', 'dashboard_unreachable');

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

`GET /alerts` only ever filtered by current `resolved` state until the period-close summary (see [API.md](API.md#reports--exports)) added the first `raised_at`-range query — no schema change, `raised_at` already existed.

`dashboard_unreachable` is raised by `POST /system/dashboard-url/health` (see `dashboard_url` below) via the exceptions worker's own `raiseAlert` — same dedup-while-unresolved semantics as every other type here, reused rather than reimplemented. It never auto-resolves on recovery, same convention as the rest of this table; a human confirms via the Alerts page.

## dashboard_url

Tracks the current Cloudflare Quick Tunnel URL for the web dashboard and whether it's currently reachable. This repo runs Quick Tunnel mode (no domain registered — see [DEPLOYMENT.md](DEPLOYMENT.md)), which mints a new random `*.trycloudflare.com` URL on every restart and has no uptime guarantee, so this can't be a static value anywhere. Singleton table — exactly one row, seeded by migration, always `UPDATE`d afterward. `openclaw/notifier/sync-dashboard-url.mjs` (host-side, polls every 5 minutes — no container in this stack has Docker socket access) is the only writer; the agent's `get_dashboard_url` tool is the only reader.

```sql
CREATE TABLE dashboard_url (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url         TEXT NOT NULL,
  reachable   BOOLEAN NOT NULL DEFAULT true,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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

`users`/`sessions` back the web dashboard's login — entirely separate from `crew_members`, which is the WhatsApp/agent-side identity model. `role` (added in 0040) gates account management (see API.md's Users section) and, as of 0041, the Payroll routes below — the two admin-only surfaces that exist so far. `requireDashboardUser`/`requireAdmin` (`backend/src/lib/roles.ts`) are the single shared implementation both route files call.

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true, -- added in 0038; deactivated accounts keep their row (FKs from alerts/notifications)
  role          TEXT NOT NULL DEFAULT 'admin', -- added in 0040; 'admin' | 'staff', app-validated not a Postgres enum (matches crew_members.role convention)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
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

## Payroll

Wage/cash data, admin-only end to end (see API.md's Payroll section). Added in `0041_payroll.sql`. `crew_pay_profiles` establishes *what someone is paid*; `payouts` records *what they were actually paid*, independently. No agent-facing route exists for either table: recording money paid to someone is exactly the kind of mutating action the (not-yet-built) two-party confirm-before-execute redesign is meant to gate, so this stays dashboard-only until that exists.

`GET /payroll/reconciliation` compares the two — it's a computed view, not a stored table: completed timesheet hours (`fetchSessionsInRange`, `backend/src/lib/timeclock.ts`) × `crew_pay_profiles.hourly_rate`, against `payouts` summed over the same range. Nothing here persists; every call recomputes from `timeclock_entries`, `crew_pay_profiles`, and `payouts` directly.

```sql
CREATE TABLE crew_pay_profiles (
  crew_member_id  UUID PRIMARY KEY REFERENCES crew_members(id),
  pay_type        TEXT NOT NULL DEFAULT 'payroll' CHECK (pay_type IN ('payroll', 'cash')),
  hourly_rate     NUMERIC CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No row means "not set yet" (defaults: payroll, no rate) -- a crew member
-- doesn't get one created at signup; PATCH /crew-members/:id/pay-profile
-- upserts on first write.
CREATE TABLE payouts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id       UUID NOT NULL REFERENCES crew_members(id),
  amount               NUMERIC NOT NULL CHECK (amount > 0),
  paid_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  note                 TEXT,
  recorded_by_user_id  UUID NOT NULL REFERENCES users(id), -- always a dashboard admin, no dual-path actor -- see above
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Spending

Money-handling data, admin-only for dashboard sessions on every route in `spending.ts` — like Payroll above, with one exception: `GET /spend-records/missing-receipts` passes the service token through ungated (same dual-path pattern as `GET /pending-confirmations`), since it's a read-only "are we missing a receipt for X" check the agent can also answer over WhatsApp, not sensitive enough to restrict to the dashboard. Added in `0042_spend.sql`. Company card purchases, petty cash spend, mileage claims, and reimbursable receipts are all the same underlying shape (an amount, who, when, how it was paid, and — sometimes — management's approval), so they share one `spend_records` table with a `method`/`category` pair rather than four bespoke tables. Material cost (`order_items.unit_cost`, above) is deliberately *not* part of this — it's a property of an existing order line item flowing through the ordering/PO pipeline, not a standalone spend event.

`GET /spend-records/missing-receipts` and the period-close summary's own missing-receipts callout (see [API.md](API.md#reports--exports)) both read `document_id IS NULL AND category != 'mileage' AND status = 'approved'` — no schema change, `document_id` was already nullable and never enforced.

`spend_records` rows aren't only created through `spending.ts` anymore, though: an approved `mileage_claim` pending confirmation (see Confirmations below) inserts one directly, already `approved`, from either a dashboard admin or a `management`-role crew member over WhatsApp. `submitted_by`/`reviewed_by` (crew member) and `submitted_by_user_id`/`reviewed_by_user_id` (dashboard user) are dual-path pairs for exactly this reason — added in `0044_pending_confirmations_reviewed_by.sql`, which also dropped `submitted_by_user_id`'s `NOT NULL` (a WhatsApp-approved row has no dashboard user id to put there). `POST /spend-records` itself still only ever sets the `_user_id` half, since that route stays dashboard-only.

`money_instruments` + `money_instrument_custody` track company cards and petty cash floats — who currently has one, and the history of who's held it. `balance` is a directly hand-adjusted running number (`PATCH /money-instruments/:id/balance`, `{delta}`), same "null/unused" and manual-adjustment convention as `consumables.quantity_on_hand` — nothing in `spend_records` auto-decrements it.

```sql
CREATE TABLE money_instruments (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type    TEXT NOT NULL CHECK (type IN ('company_card', 'petty_cash')),
  label   TEXT NOT NULL,
  balance NUMERIC, -- petty_cash only; null/unused for company_card
  active  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE money_instrument_custody (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id        UUID NOT NULL REFERENCES money_instruments(id),
  held_by              UUID NOT NULL REFERENCES crew_members(id),
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at             TIMESTAMPTZ, -- null = current holder
  assigned_by_user_id  UUID NOT NULL REFERENCES users(id)
);

-- status defaults 'approved' -- most rows are a record of money already
-- spent with a card or float, not a request. method = 'personal_reimbursed'
-- starts 'pending' instead: a mileage claim's amount isn't known until a
-- rate is set at approval, and a reimbursable receipt is a claim that needs
-- sign-off before being trusted, per this session's "crew claims need
-- independent verification" principle.
CREATE TABLE spend_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category              TEXT NOT NULL, -- app-validated: material, fuel, mileage, receipt, other
  method                TEXT NOT NULL CHECK (method IN ('cash', 'company_card', 'personal_reimbursed')),
  status                TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  amount                NUMERIC CHECK (amount IS NULL OR amount >= 0), -- null only while a pending mileage claim awaits a rate
  distance_km           NUMERIC CHECK (distance_km IS NULL OR distance_km >= 0), -- mileage only
  rate_per_km           NUMERIC CHECK (rate_per_km IS NULL OR rate_per_km >= 0), -- set at approval, mileage only
  description           TEXT,
  document_id           UUID REFERENCES documents(id), -- optional linked receipt photo
  instrument_id         UUID REFERENCES money_instruments(id),
  crew_member_id        UUID REFERENCES crew_members(id),
  submitted_by          UUID REFERENCES crew_members(id), -- added in 0044; set only for a WhatsApp-approved mileage claim
  submitted_by_user_id  UUID REFERENCES users(id), -- nullable as of 0044 -- see dual-path note above
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by           UUID REFERENCES crew_members(id), -- added in 0044
  reviewed_by_user_id   UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Confirmations

Two-party confirm-before-execute — a **pilot**, not a full cutover: only 6 of the agent's 58 tools route through this (`log_timeclock_event`, `adjust_consumable_quantity`, `return_checkout`, `submit_mileage_claim`, `verify_asset`, `mark_purchase_order_fulfilled`) — self-reported physical-reality/money claims where the crew member's own confirmation isn't independent verification of anything (hours, material-usage, damage/condition claims, mileage, asset condition, delivery receipt). The other mutating tools are unchanged — the crew member's own confirmation is still sufficient for those. Added in `0043_pending_confirmations.sql`; `action_type` widened to 6 values in `0045_pending_confirmations_more_action_types.sql`. See [API.md](API.md#confirmations) and [ARCHITECTURE.md](ARCHITECTURE.md).

A pending confirmation is backed by a real `critical` row in `notifications` (`notification_id`) — escalation is inherited from that table's existing mechanism (`notifications.ts`'s `escalated_count`/`ESCALATION_THRESHOLD_MINUTES`/`MAX_ESCALATIONS`), not duplicated here. `payload` holds whatever the original action needs (e.g. `{event_type, site_id, geofence_verified}` for a timeclock event); approving re-validates against *current* state (not state at submission time) before dispatching to the real mutation.

`reviewed_by`/`reviewed_by_user_id` (added in `0044_pending_confirmations_reviewed_by.sql`) are a dual-path pair — management can review from the dashboard (`reviewed_by_user_id`, admin session) or WhatsApp (`reviewed_by`, a crew member whose `role = 'management'`; the backend 403s otherwise — the first place `crew_members.role` is checked anywhere in this codebase). The linked notification's `acknowledged_by`/`acknowledged_by_user_id` are set the same way when a review happens.

```sql
CREATE TABLE pending_confirmations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type          TEXT NOT NULL CHECK (action_type IN ('timeclock_event', 'consumable_adjustment', 'checkout_return', 'mileage_claim', 'asset_verification', 'purchase_order_fulfillment')), -- widened from 4 to 6 in 0045
  summary              TEXT NOT NULL, -- agent-authored, human-readable -- what the manager sees, on the dashboard or in a WhatsApp list
  payload              JSONB NOT NULL, -- args needed to execute the action once approved
  crew_member_id       UUID NOT NULL REFERENCES crew_members(id),
  status               TEXT NOT NULL DEFAULT 'awaiting_management' CHECK (status IN ('awaiting_management', 'approved', 'rejected', 'expired')),
  notification_id      UUID NOT NULL REFERENCES notifications(id),
  reviewed_by          UUID REFERENCES crew_members(id), -- added in 0044; WhatsApp path, role='management' enforced
  reviewed_by_user_id  UUID REFERENCES users(id), -- dashboard path
  reviewed_at          TIMESTAMPTZ,
  result_id            UUID, -- id of the row actually created once approved (e.g. the new timeclock_entries row)
  crew_notified_at     TIMESTAMPTZ, -- set once the outcome has been sent back to the crew member over WhatsApp
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`expirePendingConfirmations` (`backend/src/workers/exceptions.ts`, part of the regular exceptions-worker sweep) flips a row to `expired` once its linked notification has exhausted its escalations with nobody acting on it — the crew member is told it wasn't approved in time rather than left waiting forever. Outcome delivery (`openclaw/notifier/deliver-confirmation-outcomes.mjs`) is a host-side script targeting `crew_members.phone` directly, the same pattern `nudge-shifts.mjs` already established, since the backend container has no network path to send WhatsApp messages itself.

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
