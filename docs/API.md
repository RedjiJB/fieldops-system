# Backend API

REST API that the OpenClaw agent calls as tools, and that a future web dashboard reads from directly. Not yet implemented — this is the contract to build against (see [ROADMAP.md](ROADMAP.md)). Base path: `/api/v1`.

Every mutating endpoint (POST/PATCH/DELETE) that the agent calls should be treated as requiring a confirmed action upstream — the agent echoes back to the crew member before calling it, per the confirm-before-execute principle in [ARCHITECTURE.md](ARCHITECTURE.md). The API itself doesn't enforce confirmation; that's the agent's job. The API's job is to refuse anything that violates a data rule (e.g. assigning an unconfirmed asset).

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
| `PATCH` | `/checkouts/:id/return` | Check an asset back in, optionally with damage flag + photo |
| `GET` | `/checkouts/overdue` | Assets past expected return, not yet checked in |

## Orders

| Method | Path | Description |
|---|---|---|
| `POST` | `/orders` | Create an order (site, date needed, items, spec notes) |
| `GET` | `/orders?status=&site_id=` | List/filter orders |
| `PATCH` | `/orders/:id/status` | Advance order status |
| `POST` | `/orders/:id/compile-po` | Compile order into a purchase order draft (items, quantities, specs) for routing to `info@` or a picker |
| `POST` | `/transfers` | Request a direct site-to-site equipment transfer |
| `PATCH` | `/transfers/:id/status` | Update transfer status |

## Vendors & Purchase Orders

| Method | Path | Description |
|---|---|---|
| `GET` | `/vendors` | List vendors with contact method + account info |
| `POST` | `/vendors` | Add a vendor |
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
| `GET` | `/shifts?date=&site_id=&crew_member_id=` | List shifts |
| `POST` | `/timeclock` | Log a check-in/break/check-out event |
| `GET` | `/crew/status` | Live status for every active crew member (site, last event, geofence match) — powers the team-wide map view |

## Vehicles & Location

| Method | Path | Description |
|---|---|---|
| `POST` | `/vehicles/:id/telemetry` | Log a WhatsApp location share against a vehicle |
| `POST` | `/trips` | Start/label a trip ("dump run", "sod pickup") |
| `PATCH` | `/trips/:id/end` | Close out a trip |
| `GET` | `/vehicles/:id/trips` | Trip history for a vehicle |

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
