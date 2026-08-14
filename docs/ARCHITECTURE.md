# Architecture

## Overview

A single backend, with **WhatsApp (via OpenClaw + an LLM agent)** as the primary interface for crews and management, and a **web dashboard** for anything that genuinely needs a screen (bulk setup, reports).

```
Crew / Management phone (WhatsApp)
        ↕
OpenClaw gateway (self-hosted, WhatsApp channel, QR-paired)
        ↕
Agent (DeepSeek → Kimi → OpenAI → Gemini → Claude fallback chain — tool-use enabled)
   ── Speech-to-text (voice notes, live via OpenAI gpt-4o-transcribe) ── OCR (receipts/tickets, not yet built)
        ↕
Backend API (REST)
        ↕
Postgres  +  WhatsApp shared location (live + one-time pins) for real-time position — POC phase, no hardware
        ↕
Web dashboard (management) + Map view — v1 built: login + live vehicle-location map (see openclaw/README.md and docs/DEPLOYMENT.md#dashboard-auth-rollout). Additional screens (ops overview, inventory browser, reports) not yet built.
```

Outbound material orders don't hit a vendor API directly — the agent compiles the order details and sends them to `info@thesodboys.ca` (or straight to whoever's picking it up), for a human to actually contact the vendor. See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for the `purchase_orders` status flow.

## Design principles

1. **Crew-facing = scan/text/photo, almost no typing.** Loadouts check out with one QR scan; corrections happen through natural language, not forms.
2. **Management-facing = dashboard + WhatsApp queries.** Anything that needs a quick answer ("who has the compactor") goes through chat; anything that needs a screen (reports, template editing) goes through the dashboard.
3. **Confirm before execute.** Any agent action that moves inventory, money, or a schedule gets echoed back for a yes/no before it commits. This is non-negotiable — a misheard voice note should never silently move equipment or place an order. For four specific actions — hours (`log_timeclock_event`), material-usage claims (`adjust_consumable_quantity`), damage/condition claims on returns (`return_checkout`), and mileage claims (`submit_mileage_claim`) — the crew member's confirmation alone is no longer enough: these route through `pending_confirmations` (see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#confirmations)) and also need management's sign-off before they take effect, since a crew member confirming their own claim isn't independent verification of anything. This is a **pilot** on the cases that most needed it, not a cutover of the other ~49 mutating tools, which stay single-party for now.
4. **The system notices first.** Idle crews, wrong-site arrivals, stalled orders — the exceptions engine compares expected state against actual state continuously and raises a flag before a person has to complain. See [EXCEPTION_HANDLING.md](EXCEPTION_HANDLING.md).
5. **Nothing gets assigned that isn't confirmed to exist.** An asset with no verification record is treated as unconfirmed, never assigned by the loadout engine. See the bootstrap audit process below.
6. **No direct vendor ordering, deliberately, for now.** The agent prepares information; a human sends it. This can change in a later phase once the manual workflow is proven.

## Inventory bootstrapping

There's real equipment and material history scattered across past job sites, trucks, and the crew's storage unit — none of it starts out in the system. The rule: **the loadout engine only ever assigns what's been confirmed to exist.** An asset without a verification timestamp is unconfirmed, not available, and a loadout that needs it shows a shortfall instead of silently proceeding.

Bootstrapping is a physical sweep (Access Storage, active sites, trucks) tagging every asset with a QR code, condition, and status — split across the crew as part of normal days rather than one big shutdown-and-count event. Full detail in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#assets) under the `assets.status` / `last_verified_at` fields.

## Management notifications

Principle 4 ("the system notices first") originally only meant alerts sat in Postgres until someone asked (`list_alerts`) or a fixed-time digest cron read them out. As of 2026-08, genuine exceptions push to management on WhatsApp within a minute of happening, without waiting for a digest — a tool marked missing/retired, a vehicle outside its geofence, an overdue checkout, or a stalled order. Everything else (normal registration/verification, routine order progress, idle-crew flags) stays digest-only, to avoid turning this into a stream of pings once real crew are onboarded.

This couldn't be built as "the backend calls OpenClaw directly," because it structurally can't: the backend runs in its own Docker container with no filesystem access to the `openclaw` binary (a native systemd service on the Pi host, not in `docker-compose.yml`) and no network path to the gateway (loopback-bound on the host, not reachable from inside the container). So the flow keeps the one direction that already works everywhere else in this system — OpenClaw calling the backend's HTTP API, never the reverse — just inverted into a poll instead of a push:

```
Backend route/worker detects an event
        ↓ (writes a pre-formatted message)
Postgres `notifications` table (priority: critical | routine)
        ↓ (polled every minute, host-side)
openclaw/notifier/deliver-notifications.mjs  (runs as an `openclaw cron --command` job, on the Pi host)
        ↓ (critical only — routine rows are pulled separately by the digest agent's list_notifications tool)
openclaw message send --channel whatsapp     (direct send, no LLM call)
        ↓
Management's WhatsApp
```

If a critical notification is delivered but nobody acknowledges it within 20 minutes, the same script's second pass re-sends it (capped at 3 escalations) — see `GET /notifications/escalation-candidates`. Acknowledgment itself happens from a WhatsApp reply, resolved by the agent via `list_notifications`/`acknowledge_notification` (see `AGENTS.md`'s "Acknowledging critical notifications"), or from the dashboard's activity feed — either way it's tracked entirely on the `notifications` row and deliberately never touches `alerts.resolved_at`: "seen, on it" and "actually fixed" are different states.

A second, separate script (`openclaw/notifier/nudge-shifts.mjs`, its own daily cron job) follows the same "poll the backend, push via `openclaw message send`" shape but targets a crew member directly rather than management — reminding them to confirm tomorrow's shift the evening before, rather than waiting for them to forget.

See `openclaw/notifier/README.md` for both scripts and their cron jobs, and [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#notifications) for the table.

## Hosting (POC)

Self-hosted on a Raspberry Pi 5 (8GB), via Docker Compose — Postgres, backend API, and OpenClaw as separate services. Exposed through **Cloudflare Tunnel** rather than router port-forwarding, so nothing on the home network accepts inbound connections directly. Runs off a USB SSD, not the microSD card — sustained Postgres writes wear microSD out quickly. Nightly `pg_dump` backup to a second location. Migrating to a small VPS later is a same-`docker-compose.yml` move if this graduates past POC. Full setup in [DEPLOYMENT.md](DEPLOYMENT.md).

## Model provider

A 5-provider fallback chain, cheapest to most expensive, each one only tried if the previous fails or times out: **DeepSeek** (`deepseek-chat`) → **Kimi/Moonshot** (`kimi-k2.6`) → **OpenAI** (`gpt-5.4-mini`) → **Gemini** (`gemini-2.5-flash`) → **Claude** (`claude-sonnet-5`). DeepSeek handles the large majority of dispatch/ordering/status traffic at near-zero cost; everything after it is pure resilience — a provider outage or rate limit shouldn't take the agent down, and each fallback step also happens to run on different underlying infrastructure than the one before it. Configured per-agent (scoped to the `fieldops` agent specifically, not the personal `main` agent) via `openclaw models set` / `openclaw models fallbacks add` — see `openclaw/openclaw.config.example.json`.

## Location strategy (POC)

WhatsApp shared location (live location for continuous tracking, one-time pins for point-in-time check-ins) is the sole real-time position source for the POC — no OBD hardware yet. This depends on people actually sharing live location, which is a real behavior change worth reinforcing at onboarding (only 6 location shares happened across 10 weeks of the real chat history this system was designed from). OBD telemetry remains a future upgrade once the workflow is proven.
