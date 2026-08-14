# FieldOps Tools

OpenClaw tool plugin wrapping the fieldops-system backend API (`../../../backend`) as agent-callable tools, so the WhatsApp agent can act on real inventory data instead of just talking about it.

Configure `backendUrl` (defaults to `http://localhost:3000/api/v1`) via the plugin's config entry if the backend isn't on localhost.

All 58 tools from every docs/API.md group are wired up and smoke-tested against the live backend:

- **Assets & Inventory** — `list_assets`, `get_asset`, `register_asset`, `verify_asset`, `update_asset_status`, `list_consumables`, `adjust_consumable_quantity`, `get_site_inventory`
- **Loadouts & Checkout** — `list_loadouts`, `create_loadout`, `resolve_loadout`, `checkout_asset`, `return_checkout`, `list_overdue_checkouts`
- **Orders & Transfers** — `create_order`, `list_orders`, `update_order_status`, `compile_purchase_order`, `request_transfer`, `update_transfer_status`
- **Vendors & Purchase Orders** — `list_vendors`, `add_vendor`, `send_purchase_order`, `mark_purchase_order_fulfilled`
- **Scheduling & Check-in** — `assign_shift`, `confirm_shift`, `list_shifts`, `log_timeclock_event`, `get_crew_status`
- **Alerts** — `list_alerts`, `resolve_alert`
- **Vehicles & Location** — `log_vehicle_location`, `start_trip`, `end_trip`, `list_vehicle_trips`
- **Documents** — `log_document`, `list_documents`, `list_expiring_documents`
- **Compliance** — `list_missing_receipts` (spend with no linked receipt — a year-end/tax-prep check, distinct from `list_expiring_documents`)

## Build

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```
