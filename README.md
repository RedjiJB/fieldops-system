# Field Ops System

A WhatsApp-native inventory, equipment, and dispatch system for a landscaping/construction crew — built so that scheduling, equipment loadouts, material ordering, and check-ins run through conversational messages instead of scattered group chats, spreadsheets, and memory.

**Status: v1, demo-ready.** Backend API, the WhatsApp agent (78 tools), status digests with an IT-reviewed message-draft queue, photo auto-logging, geofence-verified check-in, shift reminders, crew/vehicle live location with staleness alerts, shift extension, carpool coordination, and a full web dashboard (not just the map) are all built and deployed. See [CHANGELOG.md](CHANGELOG.md) for how it got here, [docs/ROADMAP.md](docs/ROADMAP.md) for what's done vs. still open, and `openclaw/README.md` for the agent/plugin layer.

## What this is

Crews and management interact almost entirely through WhatsApp. An AI agent (via [OpenClaw](https://docs.openclaw.ai), model-agnostic — currently DeepSeek primary with Claude as fallback) sits between WhatsApp and a Postgres-backed API, handling:

- Equipment/asset checkout via QR, loadout templates that scale with crew size
- Material ordering, with orders compiled and routed to info@ for manual vendor contact (no direct vendor API in this phase)
- Scheduling, shift confirmation, and geofenced check-in
- Real-time crew location/status via WhatsApp shared location
- An exceptions/alerts engine that surfaces problems (idle crew, wrong site, stalled order) before someone has to notice and complain
- Documents — contracts, permits, receipts, disposal tickets — auto-filed per job

This system was designed directly from a real WhatsApp export from an active crew, not built abstractly — see [docs/GLOSSARY.md](docs/GLOSSARY.md) for the real trade terms, shorthand, and vendor names it's built to understand.

## Directory structure

```
fieldops-system/
├── README.md                    ← you are here
├── CHANGELOG.md                 ← full build history, dated
├── CONTRIBUTING.md              ← dev setup, testing, deploy process, conventions
├── docker-compose.yml           ← Postgres + backend + OpenClaw + Cloudflare Tunnel
├── .env.example                 ← required environment variables
├── .gitignore
├── docs/
│   ├── ARCHITECTURE.md          ← system overview, data flow, hosting
│   ├── DATABASE_SCHEMA.md       ← full Postgres schema (DDL)
│   ├── API.md                   ← backend API contract
│   ├── GLOSSARY.md              ← real trade terms/shorthand/vendors, for agent parsing
│   ├── LOADOUT_TEMPLATES.md     ← real loadout templates seeded from crew data
│   ├── EXCEPTION_HANDLING.md    ← failure patterns → system response
│   ├── USER_STORIES.md          ← full user stories by role
│   ├── DEPLOYMENT.md            ← self-hosting setup (Pi + Docker + Cloudflare Tunnel)
│   ├── SECURITY.md              ← threat model, verified findings, what's fixed vs. still open
│   ├── DEMO_SCRIPT.md           ← timed walkthrough + WiFi-outage fallback plan
│   └── ROADMAP.md               ← build phases + timeline
├── backend/                     ← Postgres schema migrations + REST API + dashboard auth
├── frontend/                    ← web dashboard (React + Vite + Leaflet) — full admin/crew/foreman UI
├── openclaw/                    ← OpenClaw config, agent workspace, tool/hook plugins, notifier scripts, agent-tests
│   ├── openclaw.config.example.json
│   ├── agent-workspace/         ← the fieldops agent's system prompt (AGENTS.md, etc.)
│   ├── plugins/                 ← fieldops-tools (agent tools), fieldops-media (WhatsApp photo hook)
│   ├── notifier/                ← host-side cron scripts (digests, reminders, backups, monitoring)
│   ├── agent-tests/             ← live tool-calling behavior suite (no real WhatsApp sends)
│   └── README.md
└── scripts/                     ← one-off tooling (QR generation, bootstrap audit helpers)
    └── README.md
```

## Quick start

```bash
git clone <this-repo>
cd fieldops-system
cp .env.example .env        # fill in real values
docker compose up -d
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full self-hosting setup, including Cloudflare Tunnel and Raspberry Pi-specific notes.

## Reading order for a new contributor

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the shape of the whole system
2. [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) — what data exists and how it relates
3. [docs/USER_STORIES.md](docs/USER_STORIES.md) — what each role actually needs to do
4. [docs/GLOSSARY.md](docs/GLOSSARY.md) + [docs/LOADOUT_TEMPLATES.md](docs/LOADOUT_TEMPLATES.md) — the real-world vocabulary and kits this system has to get right
5. [docs/EXCEPTION_HANDLING.md](docs/EXCEPTION_HANDLING.md) — the failure modes this system exists to catch
6. [docs/ROADMAP.md](docs/ROADMAP.md) — what's built, what's next
7. [CONTRIBUTING.md](CONTRIBUTING.md) — before making a change: local setup, testing, migrations, and the conventions this repo actually enforces
8. [CHANGELOG.md](CHANGELOG.md) — how the system got here, in order
