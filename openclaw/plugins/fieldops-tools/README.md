# FieldOps Tools

OpenClaw tool plugin wrapping the fieldops-system backend API (`../../../backend`) as agent-callable tools, so the WhatsApp agent can act on real inventory data instead of just talking about it.

Configure `backendUrl` (defaults to `http://localhost:3000/api/v1`) via the plugin's config entry if the backend isn't on localhost.

All 69 tools from every docs/API.md group are wired up and smoke-tested against the live backend:

- **Assets & Inventory** — `list_assets`, `get_asset`, `register_asset`, `verify_asset`, `update_asset_status`, `list_consumables`, `adjust_consumable_quantity`, `get_site_inventory`
- **Crew** — `list_crew_members` (`phone` filter resolves a WhatsApp sender to a `crew_member_id`), `register_crew_member`, `set_preferred_language` (`en`/`fr` — agent conversation only, doesn't translate the dashboard or system-generated notification templates)
- **Loadouts & Checkout** — `list_loadouts`, `create_loadout`, `resolve_loadout`, `checkout_asset`, `return_checkout`, `list_overdue_checkouts`
- **Orders & Transfers** — `create_order`, `list_orders`, `update_order_status`, `compile_purchase_order`, `request_transfer`, `update_transfer_status`
- **Vendors & Purchase Orders** — `list_vendors`, `add_vendor`, `send_purchase_order`, `mark_purchase_order_fulfilled`
- **Scheduling & Check-in** — `assign_shift`, `confirm_shift`, `list_shifts`, `log_timeclock_event`, `get_crew_status`
- **Alerts** — `list_alerts`, `resolve_alert`
- **Vehicles & Location** — `log_vehicle_location`, `start_trip`, `end_trip`, `list_vehicle_trips`
- **Documents** — `log_document`, `list_documents`, `list_expiring_documents`, `classify_document` (upgrades an auto-filed photo's type to receipt/permit/contract/insurance_cert/disposal_ticket once `tools.media.image`'s description makes it clear — see `fieldops-media`'s README)
- **Compliance** — `list_missing_receipts` (spend with no linked receipt — a year-end/tax-prep check, distinct from `list_expiring_documents`)
- **Spend & Dispute/Appeal** — `list_my_spend_records` (a crew member's own material/fuel/receipt/other claims — mileage claims live in `list_pending_confirmations` instead until approved), `dispute_rejected_claim` (lets a rejected claim's own crew member contest it once — either a `spend_record` or a `pending_confirmation`; puts it back in front of management for one more look, see `docs/API.md`'s dispute/appeal path notes)
- **System** — `get_dashboard_url` (current Cloudflare Quick Tunnel URL + last health check, never a static string — see `openclaw/notifier/sync-dashboard-url.mjs`), `restart_dashboard_tunnel` (the one tool here that shells out to `docker` on the host directly instead of calling the backend — see its code comment), `send_dashboard_login_link` (mints a 15-minute single-use WhatsApp magic-link token via `POST /auth/login-token` and returns the full redeem URL — see `docs/API.md#auth`; always call with the resolved sender's own `crew_member_id`, never someone else's), `get_backup_status` (last nightly `pg_dump` outcome — see `openclaw/notifier/backup-database.mjs`), `get_model_usage_summary` (token usage and API cost by provider/model/month — see `openclaw/notifier/sync-model-usage.mjs`), `report_it_issue` (instant critical alert for a system/technical problem, routed to `notification_settings.it_escalation_roles` rather than the broader `critical_notification_roles` broadcast — see `openclaw/notifier/heartbeat.mjs` for the complementary self-monitoring side of this), `send_role_digest` (the one tool here that sends a WhatsApp message directly instead of returning data — DMs a role-queried recipient list by shelling out to `openclaw message send`, same mechanism `deliver-notifications.mjs` uses; scoped to the three scheduled digest crons only, see AGENTS.md's "Scheduled digests: group vs. DM")

## Build

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```
