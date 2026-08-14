# FieldOps Tools

OpenClaw tool plugin wrapping the fieldops-system backend API (`../../../backend`) as agent-callable tools, so the WhatsApp agent can act on real inventory data instead of just talking about it.

Configure `backendUrl` (defaults to `http://localhost:3000/api/v1`) via the plugin's config entry if the backend isn't on localhost.

All 62 tools from every docs/API.md group are wired up and smoke-tested against the live backend:

- **Assets & Inventory** — `list_assets`, `get_asset`, `register_asset`, `verify_asset`, `update_asset_status`, `list_consumables`, `adjust_consumable_quantity`, `get_site_inventory`
- **Loadouts & Checkout** — `list_loadouts`, `create_loadout`, `resolve_loadout`, `checkout_asset`, `return_checkout`, `list_overdue_checkouts`
- **Orders & Transfers** — `create_order`, `list_orders`, `update_order_status`, `compile_purchase_order`, `request_transfer`, `update_transfer_status`
- **Vendors & Purchase Orders** — `list_vendors`, `add_vendor`, `send_purchase_order`, `mark_purchase_order_fulfilled`
- **Scheduling & Check-in** — `assign_shift`, `confirm_shift`, `list_shifts`, `log_timeclock_event`, `get_crew_status`
- **Alerts** — `list_alerts`, `resolve_alert`
- **Vehicles & Location** — `log_vehicle_location`, `start_trip`, `end_trip`, `list_vehicle_trips`
- **Documents** — `log_document`, `list_documents`, `list_expiring_documents`, `classify_document` (upgrades an auto-filed photo's type to receipt/permit/contract/insurance_cert/disposal_ticket once `tools.media.image`'s description makes it clear — see `fieldops-media`'s README)
- **Compliance** — `list_missing_receipts` (spend with no linked receipt — a year-end/tax-prep check, distinct from `list_expiring_documents`)
- **System** — `get_dashboard_url` (current Cloudflare Quick Tunnel URL + last health check, never a static string — see `openclaw/notifier/sync-dashboard-url.mjs`), `restart_dashboard_tunnel` (the one tool here that shells out to `docker` on the host directly instead of calling the backend — see its code comment), `send_dashboard_login_link` (mints a 15-minute single-use WhatsApp magic-link token via `POST /auth/login-token` and returns the full redeem URL — see `docs/API.md#auth`; always call with the resolved sender's own `crew_member_id`, never someone else's)

## Build

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```
