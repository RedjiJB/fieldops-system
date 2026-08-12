# FieldOps Tools

OpenClaw tool plugin wrapping the fieldops-system backend API (`../../../backend`) as agent-callable tools, so the WhatsApp agent can act on real inventory data instead of just talking about it.

Configure `backendUrl` (defaults to `http://localhost:3000/api/v1`) via the plugin's config entry if the backend isn't on localhost.

**Assets & Inventory group (done):**

- `list_assets`, `get_asset`, `register_asset`, `verify_asset`, `update_asset_status`
- `list_consumables`, `adjust_consumable_quantity`
- `get_site_inventory`

Remaining API.md groups (Loadouts & Checkout, Orders, Vendors/PO, Scheduling, Alerts, Vehicles/Location, Documents) aren't wired up yet — add as additional `tool({...})` entries in `src/index.ts`.

## Build

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```
