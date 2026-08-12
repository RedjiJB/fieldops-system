# openclaw/

OpenClaw gateway configuration and agent tool plugins.

OpenClaw is a CLI tool (`curl -fsSL https://openclaw.ai/install.sh | bash`), not a Docker service — it runs as a native systemd user service on the host. See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) for the real install/run steps. `docker-compose.yml` only manages Postgres and the backend.

- `openclaw.config.example.json` — reference config, verified against a real running OpenClaw 2026.7.1-2 instance (`openclaw config schema` / `openclaw config get`), not just docs. Set `tools.profile` to `messaging`, not the `coding` default — this agent talks to crew over WhatsApp, it shouldn't have shell/file/coding tools. Don't hand-edit API keys into a config file; use `openclaw onboard --deepseek-api-key <key> ...` or `openclaw config set` so credentials go through OpenClaw's own secret handling.
- `plugins/fieldops-tools/` — the agent tool plugin mapping the backend API ([../docs/API.md](../docs/API.md)) to callable tools, built with OpenClaw's `defineToolPlugin` SDK (`openclaw plugins init --type tool`). **All 38 tools done, across every API.md group**: Assets & Inventory (8), Loadouts & Checkout (6), Orders & Transfers (6), Vendors & Purchase Orders (4), Scheduling & Check-in (5), Alerts (2), Vehicles & Location (4), Documents (3). Built, `npm run plugin:build && npm run plugin:validate` passing, installed with `openclaw plugins install ./plugins/fieldops-tools --link`, and every tool smoke-tested end to end against the real backend — including every business-rule guard (forward-only order/transfer status, illegal timeclock transitions, wrong-site transfer rejection, PO send/fulfill state machine, damaged-checkout routing to in_maintenance).
- System prompt — including the vocabulary from [../docs/GLOSSARY.md](../docs/GLOSSARY.md) and the confirm-before-execute rule from [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — not yet written.
- Model provider (DeepSeek primary, Claude Sonnet 5 fallback) not yet configured — no API keys added yet.
- WhatsApp channel not yet paired (`openclaw channels login --channel whatsapp` — needs a phone present to scan the QR code).
