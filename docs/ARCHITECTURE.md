# Architecture

## Overview

A single backend, with **WhatsApp (via OpenClaw + an LLM agent)** as the primary interface for crews and management, and a **web dashboard** for anything that genuinely needs a screen (bulk setup, reports).

```
Crew / Management phone (WhatsApp)
        ↕
OpenClaw gateway (self-hosted, WhatsApp channel, QR-paired)
        ↕
Agent (DeepSeek → Kimi → OpenAI → Gemini → Claude fallback chain — tool-use enabled)
   ── Speech-to-text (voice notes) ── OCR (receipts/tickets)
        ↕
Backend API (REST)
        ↕
Postgres  +  WhatsApp shared location (live + one-time pins) for real-time position — POC phase, no hardware
        ↕
Web dashboard (management) + Map view (crew sees full team status; management sees everything + flags)
```

Outbound material orders don't hit a vendor API directly — the agent compiles the order details and sends them to `info@thesodboys.ca` (or straight to whoever's picking it up), for a human to actually contact the vendor. See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for the `purchase_orders` status flow.

## Design principles

1. **Crew-facing = scan/text/photo, almost no typing.** Loadouts check out with one QR scan; corrections happen through natural language, not forms.
2. **Management-facing = dashboard + WhatsApp queries.** Anything that needs a quick answer ("who has the compactor") goes through chat; anything that needs a screen (reports, template editing) goes through the dashboard.
3. **Confirm before execute.** Any agent action that moves inventory, money, or a schedule gets echoed back for a yes/no before it commits. This is non-negotiable — a misheard voice note should never silently move equipment or place an order.
4. **The system notices first.** Idle crews, wrong-site arrivals, stalled orders — the exceptions engine compares expected state against actual state continuously and raises a flag before a person has to complain. See [EXCEPTION_HANDLING.md](EXCEPTION_HANDLING.md).
5. **Nothing gets assigned that isn't confirmed to exist.** An asset with no verification record is treated as unconfirmed, never assigned by the loadout engine. See the bootstrap audit process below.
6. **No direct vendor ordering, deliberately, for now.** The agent prepares information; a human sends it. This can change in a later phase once the manual workflow is proven.

## Inventory bootstrapping

There's real equipment and material history scattered across past job sites, trucks, and the crew's storage unit — none of it starts out in the system. The rule: **the loadout engine only ever assigns what's been confirmed to exist.** An asset without a verification timestamp is unconfirmed, not available, and a loadout that needs it shows a shortfall instead of silently proceeding.

Bootstrapping is a physical sweep (Access Storage, active sites, trucks) tagging every asset with a QR code, condition, and status — split across the crew as part of normal days rather than one big shutdown-and-count event. Full detail in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#assets) under the `assets.status` / `last_verified_at` fields.

## Hosting (POC)

Self-hosted on a Raspberry Pi 5 (8GB), via Docker Compose — Postgres, backend API, and OpenClaw as separate services. Exposed through **Cloudflare Tunnel** rather than router port-forwarding, so nothing on the home network accepts inbound connections directly. Runs off a USB SSD, not the microSD card — sustained Postgres writes wear microSD out quickly. Nightly `pg_dump` backup to a second location. Migrating to a small VPS later is a same-`docker-compose.yml` move if this graduates past POC. Full setup in [DEPLOYMENT.md](DEPLOYMENT.md).

## Model provider

A 5-provider fallback chain, cheapest to most expensive, each one only tried if the previous fails or times out: **DeepSeek** (`deepseek-chat`) → **Kimi/Moonshot** (`kimi-k2.6`) → **OpenAI** (`gpt-5.4-mini`) → **Gemini** (`gemini-2.5-flash`) → **Claude** (`claude-sonnet-5`). DeepSeek handles the large majority of dispatch/ordering/status traffic at near-zero cost; everything after it is pure resilience — a provider outage or rate limit shouldn't take the agent down, and each fallback step also happens to run on different underlying infrastructure than the one before it. Configured per-agent (scoped to the `fieldops` agent specifically, not the personal `main` agent) via `openclaw models set` / `openclaw models fallbacks add` — see `openclaw/openclaw.config.example.json`.

## Location strategy (POC)

WhatsApp shared location (live location for continuous tracking, one-time pins for point-in-time check-ins) is the sole real-time position source for the POC — no OBD hardware yet. This depends on people actually sharing live location, which is a real behavior change worth reinforcing at onboarding (only 6 location shares happened across 10 weeks of the real chat history this system was designed from). OBD telemetry remains a future upgrade once the workflow is proven.
