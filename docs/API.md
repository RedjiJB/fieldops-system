# Backend API

REST API that the OpenClaw agent calls as tools, and that the web dashboard reads from directly. Base path: `/api/v1`.

Every mutating endpoint (POST/PATCH/DELETE) that the agent calls should be treated as requiring a confirmed action upstream — the agent echoes back to the crew member before calling it, per the confirm-before-execute principle in [ARCHITECTURE.md](ARCHITECTURE.md). The API itself doesn't enforce confirmation; that's the agent's job. The API's job is to refuse anything that violates a data rule (e.g. assigning an unconfirmed asset).

## Auth

Every `/api/v1/*` route requires authentication except `POST /auth/login` — either a valid dashboard session cookie, or the agent's static service token, checked by one `requireAuth` middleware. `/health` (outside `/api/v1`) stays fully public. See [DEPLOYMENT.md](DEPLOYMENT.md#dashboard-auth-rollout) for how the two credential types are provisioned.

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/login` | `{email, password}` → sets an `HttpOnly` session cookie. Public. |
| `POST` | `/auth/logout` | Deletes the current session, clears the cookie. |
| `GET` | `/auth/me` | Current dashboard user, or 401. |

Dashboard accounts can also now be created/managed from the dashboard itself (see Users below) — the CLI script still works but is no longer the only way.

## Users

Dashboard account management — distinct from `crew_members` (the WhatsApp/agent-facing table). All routes require a dashboard session (the service token is rejected with 403 — the agent has no business managing dashboard accounts). Two roles exist (`admin`/`staff`, added 0040): `GET /users` is open to any dashboard session; every mutating route is `admin`-only. `requireDashboardUser`/`requireAdmin` (`backend/src/lib/roles.ts`) are the shared guards — also used by Payroll below, the other role-gated surface. No `DELETE` — accounts are deactivated (`active = false`), never removed, to avoid orphaning `alerts.resolved_by_user_id`/`notifications.acknowledged_by_user_id`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/users` | List accounts (never returns `password_hash`); any dashboard session |
| `POST` | `/users` | Create an account — `{name, email, password, role?}`, password ≥ 8 chars, `role` defaults to `staff`; **admin only** |
| `PATCH` | `/users/:id` | Partial update of `name`/`email`/`active`/`role` — a user can't deactivate themselves; **admin only**, including self-edits |
| `PATCH` | `/users/:id/password` | Reset a password — `{new_password}`, ≥ 8 chars, no current-password check; **admin only** |

## Payroll

Wage/cash data — every route here is `admin`-only, both reads and writes (unlike Users above, there's no open `GET`). See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#payroll) for the two tables this covers. No agent-facing route: this is dashboard-only by design until the two-party confirm-before-execute redesign exists to gate money-affecting agent actions (see ARCHITECTURE.md's confirm-before-execute section).

| Method | Path | Description |
|---|---|---|
| `GET` | `/crew-members/pay-profiles` | Every crew member joined with their pay profile — `{pay_type: 'payroll', hourly_rate: null}` for anyone with no row yet |
| `PATCH` | `/crew-members/:id/pay-profile` | Upsert `{pay_type?, hourly_rate?}` — creates the profile on first write |
| `POST` | `/payouts` | Record an amount actually paid out — `{crew_member_id, amount, paid_at?, note?}`, `amount` must be > 0, `recorded_by_user_id` set from the admin session (no dual-path actor — see above) |
| `GET` | `/payouts?crew_member_id=&date_from=&date_to=` | List payouts, joined with crew member and recording-admin names, newest first |
| `GET` | `/payroll/reconciliation?crew_member_id=&date_from=&date_to=` | Computed hours (`fetchSessionsInRange`, `backend/src/lib/timeclock.ts`) × `hourly_rate`, against `payouts` summed in the same range. One row per crew member with activity in range — `amount_owed`/`difference` are `null` (not `0`) when no rate is set; `incomplete_sessions` counts sessions excluded from the hours total, never folded in as complete |

## Spending

Money-handling data — every route here is `admin`-only, both reads and writes, same rule as Payroll above. See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#spending). No agent-facing route for the same reason as Payroll: waits on the two-party confirm-before-execute redesign.

Company card purchases, petty cash spend, mileage claims, and reimbursable receipts share one `spend_records` table (`method`: `cash` / `company_card` / `personal_reimbursed`; `category`: `material` / `fuel` / `mileage` / `receipt` / `other`) rather than four bespoke ones. `category = 'mileage'` requires `method = 'personal_reimbursed'`, `distance_km` set, and `amount` omitted at submission — `amount` is computed at approval as `distance_km × rate_per_km`. Every other category requires `amount` at submission and no `distance_km`. `status` starts `'pending'` only for `method = 'personal_reimbursed'` (a claim that needs sign-off before it's trusted); everything else starts `'approved'` immediately (it's a record of money already spent, not a request).

| Method | Path | Description |
|---|---|---|
| `POST` | `/money-instruments` | `{type: 'company_card' \| 'petty_cash', label}` |
| `GET` | `/money-instruments` | List, joined with current holder name |
| `POST` | `/money-instruments/:id/assign` | `{held_by}` — closes any open custody row, opens a new one |
| `PATCH` | `/money-instruments/:id/balance` | `{delta}` — 400 if `type !== 'petty_cash'`; hand-adjusted, same convention as `consumables.quantity_on_hand` |
| `POST` | `/spend-records` | See validation rules above |
| `GET` | `/spend-records?category=&method=&status=&crew_member_id=&date_from=&date_to=` | Joined with crew/submitter/reviewer names, document filename, instrument label |
| `PATCH` | `/spend-records/:id/approve` | `{rate_per_km?}` — required (and used to compute `amount`) only when `category = 'mileage'`; 400 if not `pending` |
| `PATCH` | `/spend-records/:id/reject` | 400 if not `pending` |

## Assets & Inventory

| Method | Path | Description |
|---|---|---|
| `GET` | `/assets?status=&site_id=&category=` | List/filter assets |
| `GET` | `/assets/:id` | Asset detail + checkout history |
| `POST` | `/assets` | Register a new asset (yard staff or crew, on purchase) |
| `PATCH` | `/assets/:id/verify` | Mark verified during bootstrap sweep — sets `last_verified_at`, `status: available` |
| `PATCH` | `/assets/:id/status` | Update status (missing, in_maintenance, retired, etc.) |
| `GET` | `/consumables?stocking_type=` | List consumables, with on-hand quantities where applicable |
| `PATCH` | `/consumables/:id/quantity` | Adjust on-hand quantity (crew-reported restock/usage) |
| `GET` | `/consumables/:id/price-history` | Real transaction-time `unit_cost` values from `order_items`, newest first — feeds future job-costing/reporting, no dedicated frontend view yet |
| `GET` | `/sites?type=` | List/filter sites — surfaced as missing the same way crew-members was: nothing could register a site at all before this |
| `GET` | `/sites/:id` | Site detail |
| `POST` | `/sites` | Register a new site (job_site, depot, vendor, or shop) |
| `GET` | `/sites/:id/inventory` | Everything currently confirmed at a given site (e.g. "what's at Access Storage") |

## Loadouts & Checkout

| Method | Path | Description |
|---|---|---|
| `GET` | `/loadouts?job_type_id=` | List loadout templates |
| `POST` | `/loadouts` | Create a template (from a management/crew-lead session, or auto-captured from a first-time job) |
| `GET` | `/loadouts/:id/resolve?crew_size=` | Resolve a template into an actual item list, scaling per-crew-member quantities |
| `POST` | `/checkouts` | Check out an asset against an order |
| `PATCH` | `/checkouts/:id/return` | Check an asset back in, optionally with damage flag + photo. Records who: a dashboard session sets it from auth, otherwise `returned_by` (crew member id) is required in the body |
| `GET` | `/checkouts/overdue` | Assets past expected return, not yet checked in |

## Orders

| Method | Path | Description |
|---|---|---|
| `POST` | `/orders` | Create an order (site, date needed, items, spec notes) |
| `GET` | `/orders?status=&site_id=` | List/filter orders — doesn't include line items |
| `GET` | `/orders/:id` | Order detail including `items`, each joined to its asset/consumable name |
| `PATCH` | `/order-items/:id` | Set `{unit_cost}` — the real price paid for this specific transaction, not admin-gated (operational cost data, same as `purchase_orders.cost`) |
| `PATCH` | `/orders/:id/status` | Advance order status |
| `POST` | `/orders/:id/compile-po` | Compile order into a purchase order draft (items, quantities, specs) for routing to `info@` or a picker |
| `POST` | `/transfers` | Request a direct site-to-site equipment transfer |
| `PATCH` | `/transfers/:id/status` | Update transfer status |

## Vendors & Purchase Orders

| Method | Path | Description |
|---|---|---|
| `GET` | `/vendors` | List vendors with contact method + account info |
| `GET` | `/vendors/:id` | Get a single vendor |
| `POST` | `/vendors` | Add a vendor |
| `PATCH` | `/vendors/:id` | Partial update of a vendor's fields |
| `GET` | `/purchase-orders` | List purchase orders, joined to vendor name and (if compiled from an order) the requesting site; filter by `status`/`vendor_id` |
| `GET` | `/purchase-orders/:id` | Get a single purchase order with its line items |
| `POST` | `/purchase-orders/:id/send` | Send compiled PO info to `info@` or a specified picker contact — no direct vendor contact |
| `PATCH` | `/purchase-orders/:id/fulfilled` | Mark fulfilled once a receipt photo is logged |

## Crew Members

Surfaced by a real gap: nothing in the original spec could look up or register a crew member — `/crew/status` existed, but there was no way to resolve a WhatsApp sender's phone number to a `crew_member_id`, which the agent needs for any "my/me" style question (see EXCEPTION_HANDLING.md-adjacent note in ARCHITECTURE.md's WhatsApp-identity design intent: `crew_members.phone` is literally commented `-- WhatsApp identity` in the schema, but nothing used it until now).

| Method | Path | Description |
|---|---|---|
| `GET` | `/crew-members?phone=&role=&active=` | List/filter crew members — `phone` lookup is how the agent resolves a message sender to a crew_member_id |
| `GET` | `/crew-members/:id` | Crew member detail |
| `POST` | `/crew-members` | Register a new crew member |

## Scheduling & Check-in

| Method | Path | Description |
|---|---|---|
| `POST` | `/shifts` | Assign a shift (crew, site, date, time) |
| `POST` | `/shifts/batch` | Assign several shifts at once, all-or-nothing — matches the real dispatch pattern of one message assigning multiple people to multiple sites |
| `PATCH` | `/shifts/:id/confirm` | Crew confirms or declines |
| `GET` | `/shifts?date=&site_id=&crew_member_id=&status=&job_id=` | List shifts — includes `crew_member_phone`, used by `openclaw/notifier/nudge-shifts.mjs` to message a specific crew member directly |
| `PATCH` | `/shifts/:id/nudged` | Marks a shift-confirmation reminder sent — called by the nudge script after a successful send, so a same-evening re-run doesn't double-nudge |
| `POST` | `/timeclock` | Log a check-in/break/check-out event |
| `GET` | `/crew/status` | Live status for every active crew member (site, last event, geofence match) — powers the team-wide map view |

## Jobs

`POST /shifts` and `POST /shifts/batch` accept an optional `job_id` to link a shift to one of these — only created when a dispatch message actually names a job type; a shift without a `job_id` behaves exactly as before this existed. See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#jobs).

| Method | Path | Description |
|---|---|---|
| `POST` | `/jobs` | Create a job (`site_id`, `date`, optional `job_type_id`) |
| `GET` | `/jobs?date=&site_id=&status=` | List jobs, joined with site/job type names |
| `PATCH` | `/jobs/:id/status` | Forward-only: `not_started → in_progress → complete`. Manual only — auto-transition on geofence arrival is future work. Records who: a dashboard session sets it from auth, otherwise `changed_by` (crew member id) is required in the body |
| `GET` | `/job-types` | List known job types (existed since `0003_job_types.sql`, never had an endpoint until now) |

## Activity Log

A read-only, cross-table feed of state changes that already carry a recorded actor — distinct from `/notifications` (the priority-tiered delivery feed `OpsOverviewPage`'s "Activity" section shows). `orders`/`purchase_orders` transitions have no actor column yet, so they don't appear here.

| Method | Path | Description |
|---|---|---|
| `GET` | `/activity?event_type=&since=&limit=` | Unioned feed: job started/completed, checkout created/returned, asset verified, alert resolved, notification acknowledged, document uploaded. Sorted newest first, `limit` defaults to 100 |

## Reports & Exports

CSV downloads, all filterable by `date_from`/`date_to` (widened internally where needed so a record spanning the boundary isn't cut off, then trimmed back to the requested range). Served with `Content-Disposition: attachment` for direct browser download from `ReportsPage.tsx`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/reports/jobs.csv?date_from=&date_to=&site_id=` | Jobs with started/completed actor names |
| `GET` | `/reports/checkouts.csv?date_from=&date_to=&asset_id=` | Checkouts with checked-out-by/returned-by names and damage flags |
| `GET` | `/reports/purchase-orders.csv?date_from=&date_to=&vendor_id=` | Purchase orders with vendor/site names, cost, ETA |
| `GET` | `/reports/timesheets.csv?date_from=&date_to=&crew_member_id=` | Computed timeclock sessions (see below) — incomplete sessions export with a blank hours column and `Status = incomplete`, never a guessed number |

## Timesheets

Pairs raw `timeclock_entries` events (`in`/`break_start`/`break_end`/`out`) into sessions — see [`backend/src/lib/timeclock.ts`](../backend/src/lib/timeclock.ts)'s `computeSessions`. A session is `in → (break_start → break_end)* → out`; multiple sessions per day and multiple breaks per session are both legal. There's no `shift_id` FK on `timeclock_entries`, so sessions aren't linked to a specific `shifts` row — they're computed purely from the event stream. A dangling `in`/`break_start` with no following `out` comes back flagged `incomplete: true` with `ended_at`/`net_seconds` both `null`, never an estimated close time. Deliberately out of scope: applying a pay rate, a correction workflow for incomplete sessions, and any pay-period concept (a date-range filter covers "this week"/"this pay period" without one).

| Method | Path | Description |
|---|---|---|
| `GET` | `/timesheets/sessions?crew_member_id=&date_from=&date_to=` | Computed sessions in range, incomplete ones included (flagged, not filtered out) |

## Vehicles & Location

Surfaced by the same gap crew-members/sites had: nothing could look up or register a vehicle at all until the live-location feature needed to resolve "which vehicle does this crew member drive" from a WhatsApp location share.

| Method | Path | Description |
|---|---|---|
| `GET` | `/vehicles?assigned_crew_id=&plate=` | List/filter vehicles, each row including `latest_location` — the dashboard map view's data source |
| `GET` | `/vehicles/:id` | Vehicle detail, including `latest_location` (most recent telemetry row, or null) |
| `POST` | `/vehicles` | Register a new vehicle |
| `POST` | `/vehicles/:id/telemetry` | Log a WhatsApp location share against a vehicle — reverse-geocodes to a real address (OpenStreetMap Nominatim) automatically, reusing the last address if the vehicle hasn't moved more than ~100m |
| `POST` | `/trips` | Start/label a trip ("dump run", "sod pickup") |
| `PATCH` | `/trips/:id/end` | Close out a trip — computes and stores `distance_meters`/`duration_seconds` (see below) |
| `GET` | `/vehicles/:id/trips` | Trip history for a vehicle |

`PATCH /trips/:id/end` sums haversine distance across `vehicle_telemetry` points recorded for that vehicle between the trip's `started_at` and the close-out time. Telemetry is WhatsApp-share-driven, not continuous GPS, so this is a lower-bound distance estimate, not GPS-accurate — `distance_meters` is `NULL` (not `0`) when fewer than 2 telemetry points fall in the window, meaning no data rather than no movement.

## Documents

| Method | Path | Description |
|---|---|---|
| `POST` | `/documents` | Log a document's *metadata only* (photo, receipt, permit, etc.) with site/job tagging — no file content, just a filename record |
| `POST` | `/documents/upload` | Upload actual file content (base64) alongside metadata — stored on a persistent volume, retrievable via `/documents/:id/file`. What the WhatsApp photo auto-logging hook uses. |
| `GET` | `/documents/:id/file` | Retrieve the stored file content for a document created via `/documents/upload` |
| `GET` | `/documents?site_id=&type=` | Retrieve documents, e.g. "everything for Site 7" |
| `GET` | `/documents/expiring?within_days=` | Insurance/cert/permit expiry alerts |

## Alerts

| Method | Path | Description |
|---|---|---|
| `GET` | `/alerts?resolved=false` | Active alerts (idle, delay, wrong-site, stalled order, etc.) |
| `PATCH` | `/alerts/:id/resolve` | Mark resolved |

The alert-raising logic itself isn't a REST endpoint — it's a background job/worker comparing expected vs. actual state (shift assignments vs. check-ins, order timestamps vs. status, geofence vs. assigned site) and writing to `alerts` when it finds a gap. See [EXCEPTION_HANDLING.md](EXCEPTION_HANDLING.md).

## Notifications

A single event log feeding two different consumers — see [ARCHITECTURE.md](ARCHITECTURE.md) for the full "management notifications" data flow. Rows are inserted internally (asset status changes, newly-raised alerts, order status changes) with a pre-formatted human-readable `message`, never created directly by a client.

| Method | Path | Description |
|---|---|---|
| `GET` | `/notifications/pending` | `critical` priority, undelivered — polled every minute by `openclaw/notifier/` and pushed to WhatsApp the moment they're found |
| `GET` | `/notifications?priority=&since=&acknowledged=&whatsapp_message_id=` | Filtered list. `priority` omitted returns both (the dashboard activity feed); the `list_notifications` tool always passes `priority=routine` explicitly unless resolving an acknowledgment. |
| `PATCH` | `/notifications/:id/delivered` | Marks a `critical` row delivered; accepts optional `whatsapp_message_id` to capture the sent message's id |
| `PATCH` | `/notifications/:id/acknowledge` | "Seen, on it" — separate from resolving the underlying alert. Dashboard session sets `acknowledged_by_user_id`; agent/service-token path requires `acknowledged_by` (crew member id) in the body. 400 if already acknowledged. |
| `GET` | `/notifications/escalation-candidates` | Critical, delivered, unacknowledged for 20+ minutes, escalated fewer than 3 times — polled by the notifier's second pass |
| `PATCH` | `/notifications/:id/escalate` | Increments `escalated_count`, sets `last_escalated_at` — called by the notifier after a re-send |
| `POST` | `/notifications/safety-report` | The one notification authored directly from a conversation rather than derived from backend state — always `critical`. `{message, crew_member_id?}`. See [ARCHITECTURE.md](ARCHITECTURE.md) and `AGENTS.md`'s "Safety and emergencies". |

## Confirmations

Two-party confirm-before-execute — **pilot scope**: only `log_timeclock_event`, `adjust_consumable_quantity`, `return_checkout`, and `submit_mileage_claim` route through this today, not the agent's other ~49 mutating tools. See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#confirmations) and [ARCHITECTURE.md](ARCHITECTURE.md).

| Method | Path | Description |
|---|---|---|
| `POST` | `/pending-confirmations` | Service-token only. `{action_type, summary, payload, crew_member_id}` — creates the row and a linked `critical` notification (management's existing WhatsApp alert path handles delivery/escalation with no changes) |
| `GET` | `/pending-confirmations?status=` | `admin`-only, joined with crew member and reviewer names |
| `PATCH` | `/pending-confirmations/:id/approve` | `admin`-only. `{rate_per_km?}` — required only for `action_type: 'mileage_claim'`. Re-validates against current state (e.g. re-runs the timeclock legal-transition check) before dispatching to the real mutation; 400 if not `awaiting_management`. Also acknowledges the linked notification. |
| `PATCH` | `/pending-confirmations/:id/reject` | `admin`-only. 400 if not `awaiting_management`. Also acknowledges the linked notification. |
| `GET` | `/pending-confirmations/unnotified` | Not admin-gated (matches `GET /notifications/pending`'s precedent) — `status IN ('approved','rejected','expired') AND crew_notified_at IS NULL`, joined with `crew_members.phone`. Polled by `openclaw/notifier/deliver-confirmation-outcomes.mjs`. |
| `PATCH` | `/pending-confirmations/:id/mark-notified` | Sets `crew_notified_at = now()` — called by the outcome-delivery script after a successful WhatsApp send |
