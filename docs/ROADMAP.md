# Roadmap

This is the original pre-build plan — phases 0–7 below are what was scoped before any code existed. The system has since grown past this list (geofence verification, shift reminders, crew-level live location, shift extension, carpool, and the message-draft review queue all landed after phase 7 and aren't reflected in the table below). See [CHANGELOG.md](../CHANGELOG.md) for what was actually built, in order, [SECURITY.md](SECURITY.md) for the "what's fixed vs. still open" status, and [ROADMAP_V2.md](ROADMAP_V2.md) for post-v1 candidates. This file is kept as-is for the historical planning record, not updated to track current scope.

## Build order

| # | Phase | Notes |
|---|---|---|
| 0 | Inventory bootstrap audit | Sweep Access Storage, active sites, and trucks to tag and confirm what actually exists. Nothing else can be trusted until this baseline is real. Runs in parallel with early dev. |
| 1 | Inventory + assets + loadout templates | QR-based checkout, checked against confirmed on-hand inventory only. Start from the templates in [LOADOUT_TEMPLATES.md](LOADOUT_TEMPLATES.md). |
| 2 | Ordering flow through WhatsApp/OpenClaw | Confirm-before-execute from day one, not bolted on later. |
| 3 | Scheduling + shifts + geofenced check-in | Includes team-wide status visibility for crew. |
| 4 | Exception/alerts engine | Pulled forward in priority — this is where the biggest daily pain actually lives. See [EXCEPTION_HANDLING.md](EXCEPTION_HANDLING.md). |
| 5 | Real-time location via WhatsApp shared location | No hardware needed for POC. OBD telemetry is a later upgrade. |
| 6 | Vendor reference data | Email/`info@`-routed order info, formalizing existing vendor accounts (e.g. Richie Seed & Feed). No direct vendor API/ordering in this phase. |
| 7 | Documents module | Rides on the same photo/upload flow already built for receipts and site photos. |

## Timeline

Solo, part-time (evenings/weekends): **roughly 12–15 weeks** end to end.

| Phase | Duration |
|---|---|
| Setup: accounts, infra, bootstrap audit | 1 week |
| Database + backend API | 1.5–2 weeks |
| OpenClaw + agent wiring | 1.5–2 weeks |
| Loadouts + QR checkout | 2 weeks |
| Scheduling + check-in + location | 2 weeks |
| Exception/alerts engine | 1.5–2 weeks |
| Vendor reference + documents | 1 week |
| Pilot with one crew, then iterate | 1–2 weeks minimum |

Compresses to 6–8 weeks with full-time focus or a second contributor. **The pilot phase is the one not worth compressing** — it's the first contact between the agent and real crew phrasing/behavior, and rushing it just relocates the same tuning work to after launch.

## Model provider

DeepSeek V4 Flash as primary, Claude Sonnet 5 as automatic fallback (only triggers on error/timeout). See `openclaw/openclaw.config.example.json`.

## Explicitly out of scope for the POC

- Direct vendor API ordering — orders route to a human via `info@` instead
- OBD vehicle telemetry — WhatsApp shared location only
- RFID/backscatter tagging — QR only, since the primary equipment location (a rented storage unit) can't support fixed reader infrastructure anyway
- Sales/estimating, invoicing/payments, HR/compliance beyond basic cert-expiry alerts — these are real gaps in the full business picture but a separate phase, not this system's job yet
