# Changelog

All notable changes to fieldops-system, in the order they actually happened. There's no version-tagged release history yet — this is a single continuous v1 build, so entries are grouped by date instead. The `v1.0` label on 2026-08-16 marks the point the system reached full demo-ready scope (see [ROADMAP.md](docs/ROADMAP.md) and [DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)); dates before that are the build-up to it.

Within each day, changes are grouped **Added** / **Changed** / **Fixed** / **Security**, in the order they landed. A plugin-manifest regeneration that immediately follows a tool addition is folded into that tool's entry rather than listed separately — it's not an independent change.

## 2026-08-16 — v1.0: Geofencing, live-location, carpool, message-draft review

The demo-readiness push: the two large deferred features (geofencing/reminders/live-location/shift-extension, and carpool) got built, plus the message-draft review gate that makes every proactive agent-initiated send auditable before it goes out.

### Added
- Geofence verification: `timeclock_entries.geofence_verified` is now computed server-side from submitted coordinates against a site's radius, instead of trusted as an agent-asserted boolean.
- 1-hour-before shift reminders (`shift-reminder.mjs`, every 10 min), distinct from the existing evening-before confirmation nudge.
- Person-level live location: `crew_telemetry` table + `log_crew_location` tool, so a crew member with no assigned vehicle now has a location path. New `crew_location_stale` / `crew_off_site` alerts route to IT.
- Shift-extension requests (`request_shift_extension`) join the two-party confirm-before-execute pilot — an extension changes payroll hours.
- Carpool coordination: `ride_requests` table, request/match/cancel tools, `get_ride_driver_location`, and a read-only `CarpoolPage` on the dashboard. Request-based matching, no compensation tracking for v1.
- WhatsApp chat-history import pipeline (dry-run review report plus a separate apply step) to reconstruct real crew/site/shift history from an exported transcript ahead of the demo.
- IT monitoring and escalation: `heartbeat.mjs` direct-to-WhatsApp backend/Postgres down alerts, plus `connectivity_degraded` / `disk_space_low` / `it_issue` / `system_offline` alert types routed to a dedicated `IT` crew role via `report_it_issue`.
- Named Cloudflare Tunnel on `dashboard.sodboysltd.org`, replacing the earlier Quick Tunnel's random URL-per-restart; `sync-dashboard-url.mjs` rewritten to check a fixed public URL instead of scraping tunnel logs for it.
- Group vs. DM digest tiering: `send_role_digest` tool (later replaced same day, see below) and 3 digest crons retargeted to post to the crew WhatsApp group with least-privileged content, full detail still DM'd to management/owner/IT.
- Message-draft approval flow: `create_message_draft` / `list_pending_message_drafts` / `resolve_message_draft` — every proactive, agent-initiated send (digests, role pings) is now written as a pending draft and only actually sent once IT reviews and approves it. Replaces `send_role_digest` entirely. Crew/group message cap raised 200 → 400 characters.
- Nightly WhatsApp transcript export for review (`export-nightly-transcripts.mjs`).
- Timed demo script with a WiFi-outage fallback plan ([DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)).
- Build-date footer stamp and first-login welcome banner on the dashboard.

### Changed
- Foreman and management/owner crew-portal dashboard tiers now have genuinely different site scope (foreman: caller's own confirmed-shift sites only; management/owner: every site with a confirmed shift today, org-wide) — previously both tiers ran the identical self-scoped query.

### Fixed
- Wrong day-of-week label on a correct date (a pure LLM arithmetic error, not an infra bug) — `AGENTS.md` now instructs deriving the weekday from the actual date rather than assuming it.
- Dashboard login link privacy: links are now DM-only, never posted as a group reply (they're reusable for 15 minutes, so a group post would've been a live, tappable link anyone in the group could use).
- Mobile Map tab overflow that hid the sidebar/tabs.
- `dashboard_url` tracking's dead log-scraping regex, incompatible with the new named-tunnel setup.
- Stale `AGENTS.md` foreman/management scope description that didn't match the actual code.
- Cron-failure delivery leaking infrastructure details into crew WhatsApp replies; added an explicit non-disclosure clause and sanitized tool error text.
- 400-character crew/group message cap (previously 200) being applied by *channel* (any group message) rather than by the asker's resolved role.
- Group silence bug where a genuine @-mention got no reply.
- Forbade narration/meta-commentary (the agent describing its own tool calls as literal message text) in digest messages.

## 2026-08-15 — Visual redesign, compliance & security hardening

### Added
- Full OpenConstructionERP-inspired dashboard reskin and Sod Boys Ltd rebrand: sidebar nav, KPI cards, status pills, design-token layer, and 5 reusable UI primitives (Button, Card, StatCard, Badge, EmptyState) rolled out across every page.
- Skeleton/Toast/ConfirmDialog primitives, replacing native `confirm()` dialogs and bare loading states.
- Magic-link login cooldown (10 minutes) to prevent rapid re-requesting.
- Overtime / break-compliance flags computed on timeclock sessions.
- Dispute/appeal path: a rejected spend/mileage claim is no longer a final decision — crew can dispute it.
- Claim outcomes report (visibility into spend/mileage claim decisions), order reconciliation report (requested vs. purchased quantity), and a provider-agnostic payroll export report.
- Model usage/cost visibility: aggregates real per-turn token/cost data.
- Backup visibility: real nightly `pg_dump` plus failure/staleness alerting.
- Agent-tests coverage for acknowledgment and shift-confirmation reply flows.

### Fixed
- Crew-session data leak on 4 routes (spend records and pending confirmations were reachable by a crew session beyond its own scope).
- Timing-safe comparison for the service token (was a naive string compare).
- Container logs unbounded on postgres/backend/frontend, risking disk exhaustion.
- Mobile dashboard layout issues, rolled the new component system across all remaining pages, dropped single-use magic links.

### Security
- Added CSP and security headers to both backend and frontend.
- Closed the crew-session data leak and fixed the service-token timing side-channel (both listed under Fixed above — flagged here as the security-relevant subset of that day's work).

## 2026-08-14 — Two-party confirmations, role hierarchy, dashboard access

### Added
- Two-party confirm-before-execute pilot: `log_timeclock_event`, `adjust_consumable_quantity`, `return_checkout` (and shortly after, `verify_asset` and `mark_purchase_order_fulfilled`) now require management sign-off via `pending_confirmations`, not just the crew member's own confirmation.
- Management can approve/reject pending confirmations directly from WhatsApp, not just the dashboard.
- 5-tier role hierarchy: `admin`/`owner`/`management`/`foreman`/`crew`, replacing the earlier flatter model.
- Dashboard access for crew members: WhatsApp magic-link login into a scoped self-service view of their own pay, jobs/shifts, checkouts, and spend claims — a genuinely separate auth path from the admin dashboard's email+password login.
- Foreman dashboard tier: read-only site roster, site checkouts, site orders, scoped to the caller's own confirmed shift today.
- Reporting & Compliance: missing-receipts check and period-close summary.
- Inbound photo classification (receipt/permit/contract/insurance_cert/disposal_ticket) instead of always filing as generic `photo`.
- Dynamic dashboard-URL lookup, tunnel health monitoring, and a self-service tunnel-restart tool.
- Agent-facing French language support for crew members.
- Preventive maintenance scheduling (calendar-interval "next service due").
- Purchase approval trail: records and surfaces who fulfilled each PO.
- Bulk dashboard actions (shift assignment, alert resolve, notification acknowledge, asset status), search by name on Crew/Sites/Assets, live 30s polling on Ops Overview, mobile-responsive header, vendor spend summary grouped by vendor/month.

### Fixed
- 9 plugin tools that were silently unreachable by the agent due to a `tools.alsoAllow` gap.
- `restart_dashboard_tunnel`'s cooldown logic and an `AGENTS.md` bootstrap-truncation bug.
- Two notification bugs: stale keep-alive PATCH failures and log-tail URL loss.
- Nav crowding by collapsing admin-only tabs into a dropdown.
- Map now polls vehicle locations every 15s instead of fetching once.

### Changed
- First-push notification retries capped at 5 attempts.
- Delivery-tuning and exceptions-engine thresholds moved out of hardcoded constants into a Notification Settings page.

## 2026-08-13 — Dashboard v2, payroll, spend tracking

### Added
- Asset Browser and Documents & Compliance dashboard pages.
- Crew management, site management, and vehicle trip history dashboard pages.
- Loadout Template Editor, Vendors & Purchase Orders, User & Account Management, Activity Log (with jobs/checkouts actor tracking), and Reports & Exports dashboard pages.
- Voice-note transcription via OpenAI.
- Sender-safe `AGENTS.md` rules and a config template for WhatsApp group chat use.
- Dashboard role permissions (admin/staff).
- Timesheet/hours computation from raw timeclock events.
- Mixed pay structures per person (payroll vs. cash rates, payout log) and owed-vs-paid reconciliation for payroll.
- Spend & Purchasing: material cost, company card, petty cash, mileage, and receipts.

## 2026-08-12 — WhatsApp agent goes live

The day the system went from a REST API to an actual WhatsApp-driven agent.

### Added
- `fieldops-tools` OpenClaw plugin: all 38 initial tools across every `API.md` group.
- The FieldOps agent system prompt as a dedicated isolated agent, paired and bound to a real WhatsApp channel.
- 5-provider model fallback chain (DeepSeek → Kimi/Moonshot → OpenAI → Gemini → Claude).
- Crew-members/sites CRUD, real dispatch patterns in `AGENTS.md`, batch shift assignment, real file storage for document uploads.
- `fieldops-media`: hook-only plugin auto-logging inbound WhatsApp photos as documents.
- Status digest cron jobs (morning/midday/evening).
- Agent-driven (not hook-driven) live vehicle location, reverse-geocoded to real addresses.
- Web dashboard v1 (login + live vehicle map) and v2 (ops overview screen with resolve/advance actions).
- Agent tool-calling test suite (`openclaw/agent-tests`) — first version.
- Acknowledgment/escalation/vehicle-dark/shift-nudge notifications (Phase A), weather and delay alerts (Phase B), job-level tracking and `loadout_gap` (Phase C).
- Safety-emergency handling.
- Dashboard exposed via a Cloudflare Quick Tunnel (no custom domain yet).

### Fixed
- `assign_shifts_batch` missing from the plugin manifest's declared contracts.
- `tools.alsoAllow` excluding plugin tools from the messaging profile — the first real model reply revealed this.
- A real confirm-before-execute gap caught by the new agent-test suite.
- `register_vehicle` confirmation reliability.
- Two conversational accuracy bugs found alongside the safety-emergency work.
- Database timezone fixed at the root cause (not papered over per-query).

### Security
- Fixed a real stored-XSS vector, a brute-force gap, and infrastructure findings from a first security pass.

## 2026-08-11 — Core REST API

### Added
- Assets & Inventory REST endpoints.
- Loadouts & Checkout endpoints.
- Ordering flow: orders, transfers, vendors, purchase orders.
- Scheduling & Check-in endpoints.
- Exceptions/alerts engine.
- Vehicles & Location endpoints.
- Documents module.

## 2026-08-10 — Project bootstrap

### Added
- Initial documentation suite.
- Backend scaffold and full Postgres migration set.
