# FieldOps Tools

OpenClaw tool plugin wrapping the fieldops-system backend API (`../../../backend`) as agent-callable tools, so the WhatsApp agent can act on real inventory data instead of just talking about it.

Configure `backendUrl` (defaults to `http://localhost:3000/api/v1`) via the plugin's config entry if the backend isn't on localhost.

All 76 tools from every docs/API.md group are wired up and smoke-tested against the live backend (see `src/index.test.ts` for the exact declared order — it's hand-maintained, not derived, so it's the source of truth if this list and the code ever disagree):

- **Assets & Inventory** — `list_assets`, `get_asset`, `register_asset`, `verify_asset`, `update_asset_status`, `list_consumables`, `adjust_consumable_quantity`
- **Sites** — `list_sites`, `get_site`, `register_site` (`center_lat`/`center_lng`/`geofence_radius_m` back both `checkWrongSite` and the geofence-verified timeclock check below), `get_site_inventory`
- **Loadouts & Checkout** — `list_loadouts`, `create_loadout`, `resolve_loadout`, `checkout_asset`, `return_checkout`, `list_overdue_checkouts`
- **Orders & Transfers** — `create_order`, `list_orders`, `update_order_status`, `compile_purchase_order`, `request_transfer`, `update_transfer_status`
- **Vendors & Purchase Orders** — `list_vendors`, `add_vendor`, `send_purchase_order`, `mark_purchase_order_fulfilled`
- **Crew** — `list_crew_members` (`phone` filter resolves a WhatsApp sender to a `crew_member_id`), `register_crew_member`, `set_preferred_language` (`en`/`fr` — agent conversation only, doesn't translate the dashboard or system-generated notification templates)
- **Jobs & Scheduling** — `list_job_types`, `create_job`, `list_jobs`, `assign_shift`, `assign_shifts_batch`, `confirm_shift`, `list_shifts`, `log_timeclock_event` (optional `lat`/`lng` — the backend derives `geofence_verified` server-side from these against the shift's site, never a client-asserted boolean), `submit_mileage_claim`, `request_shift_extension` (changes payroll hours — two-party pilot, needs management sign-off same as the claim tools below), `get_crew_status`
- **Alerts** — `list_alerts`, `resolve_alert`
- **Vehicles & Location** — `list_vehicles`, `get_vehicle`, `register_vehicle`, `log_vehicle_location`, `log_crew_location` (person-level location — call this alongside `log_vehicle_location` whenever a location share arrives, not instead of it; the only way a crew member with no assigned vehicle gets a location path at all), `start_trip`, `end_trip`, `list_vehicle_trips`
- **Documents** — `log_document`, `classify_document` (upgrades an auto-filed photo's type to receipt/permit/contract/insurance_cert/disposal_ticket once `tools.media.image`'s description makes it clear — see `fieldops-media`'s README), `list_documents`, `list_expiring_documents`
- **Compliance** — `list_missing_receipts` (spend with no linked receipt — a year-end/tax-prep check, distinct from `list_expiring_documents`)
- **Spend & Dispute/Appeal** — `list_my_spend_records` (a crew member's own material/fuel/receipt/other claims — mileage claims live in `list_pending_confirmations` instead until approved), `dispute_rejected_claim` (lets a rejected claim's own crew member contest it once — either a `spend_record` or a `pending_confirmation`; puts it back in front of management for one more look, see `docs/API.md`'s dispute/appeal path notes)
- **System** — `get_dashboard_url` (current named-tunnel dashboard URL + last health check, never a static string — see `openclaw/notifier/sync-dashboard-url.mjs`), `get_backup_status` (last nightly `pg_dump` outcome — see `openclaw/notifier/backup-database.mjs`), `get_model_usage_summary` (token usage and API cost by provider/model/month — see `openclaw/notifier/sync-model-usage.mjs`), `restart_dashboard_tunnel` (the one tool here that shells out to `docker` on the host directly instead of calling the backend — see its code comment), `send_dashboard_login_link` (mints a 15-minute WhatsApp magic-link token via `POST /auth/login-token` and returns the full redeem URL — reusable within that window, not single-use, capped at one fresh link per crew member per 10 minutes; see `docs/API.md#auth`; always call with the resolved sender's own `crew_member_id`, never someone else's; DM-only, never as a group reply)
- **Notifications & Confirmations** — `list_notifications`, `acknowledge_notification`, `list_pending_confirmations`, `approve_pending_confirmation`, `reject_pending_confirmation` (management/owner-role crew only, either channel — WhatsApp or the dashboard)
- **Safety** — `report_safety_incident`
- **Carpool** — `create_ride_request`, `list_open_ride_requests`, `match_ride_requests` (a human decision, never automatic), `cancel_ride_request`, `get_ride_driver_location` (reuses `log_crew_location`/`log_vehicle_location` telemetry directly, no separate tracking mechanism)
- **Message drafts** — `create_message_draft`, `list_pending_message_drafts`, `resolve_message_draft` (the one place in this plugin a proactive, agent-initiated message actually sends — only after IT's explicit approval; replaces the earlier `send_role_digest` tool entirely, see `docs/ARCHITECTURE.md`'s "Management notifications")
- **IT** — `report_it_issue` (instant critical alert for a system/technical problem, routed to `notification_settings.it_escalation_roles` rather than the broader `critical_notification_roles` broadcast — see `openclaw/notifier/heartbeat.mjs` for the complementary self-monitoring side of this)

## Build

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```
