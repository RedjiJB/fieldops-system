# Exception Handling

Six recurring failure patterns showed up in a real 10-week crew chat, all sharing one root cause: **someone has to notice a problem and speak up before anything happens.** The system's job is to flip that — compare expected state against actual state continuously, and surface the gap before a person has to complain about it.

| Failure pattern | System response |
|---|---|
| Crew lead doesn't know how many tools/how much material is needed | Loadout quantities scale per crew member, not fixed counts. First time a job type appears with no template, the agent captures the live item list and turns it into a reusable template automatically. See [LOADOUT_TEMPLATES.md](LOADOUT_TEMPLATES.md). |
| Tools left behind / lost / not brought from storage | Loadout template acts as a pre-departure checklist — "Confirm Load" blocks on missing items unless explicitly overridden with a reason. Anything checked out but never scanned back in stays flagged "last known at [site]" instead of silently vanishing. |
| Truck takes too long / goes to the wrong site | A confirmed shift with no check-in past its scheduled start raises an alert — simpler than true travel-time tracking (see "Implementation status" below for why), but catches the same real problem. GPS vs. assigned-site geofence mismatch flags a wrong-site arrival immediately. |
| Site issue requires redirect | A formal redirect action updates the assignment, diffs what's already loaded against the new site's needs, and re-broadcasts only to the affected crew — not a full manual re-type per team. |
| Delays leave crew standing idle | If a crew is geofence-confirmed on-site but no task/order is progressing after a set window, the system flags it to management proactively, and logs the idle time so recurring bottlenecks become visible over weeks. |
| Order issues stall a job | Orders unconfirmed past an expected window auto-escalate — first to whoever owns it, then to management. The site's status shows the specific blocking dependency, not just "stalled." |

## Implementation

This is the `alerts` table plus a background worker — not a REST endpoint on its own. The worker's job is to periodically compare:

- `shifts` + `timeclock_entries` → is a confirmed crew member actually checked in where/when expected?
- `checkouts` (expected return) vs. current time → overdue equipment
- `vehicle_telemetry` vs. `sites.geofence_*` → wrong-site arrival, or unusually long transit time
- `orders.status` + `created_at` vs. an expected fulfillment window → stalled order escalation
- `loadouts` (resolved against crew size) vs. `checkouts` at departure → loadout gap before a crew leaves

Each of these, on a gap, writes a row to `alerts` (see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#alerts)) and triggers a WhatsApp notification to the relevant person(s) — management for most, plus the affected crew for redirects and teammate status changes.

This is flagged in [ROADMAP.md](ROADMAP.md) as worth pulling forward in build priority — it's where the real daily pain in the source data actually lives.

## Implementation status

`backend/src/workers/exceptions.ts` implements six alert types on a periodic timer (`ALERTS_CHECK_INTERVAL_MS`, default 5 min), deduplicating against any already-open alert of the same type for the same record: `overdue`, `order_stalled`, `idle`, `wrong_site` (circular geofences only — polygon sites aren't checked yet), `vehicle_dark`, and `delay`. `weather` also runs on the same timer but is date-scoped rather than open/resolved-scoped (see below).

`delay` shipped as a **simpler, honest version** of the original design — a confirmed shift whose scheduled start time has passed with no check-in recorded, not real travel-time-vs-expected comparison. That original vision is still not buildable: there's no "expected travel time" concept anywhere in the schema (no site-to-site duration data), and building real routing/ETA is out of scope for what this caught. The simpler version catches the same underlying problem — crew not where they're supposed to be, on time — cheaply, on infrastructure already in place.

`weather` (new alert type, not in the original six) checks each `job_site`-type site with a confirmed shift today against Open-Meteo's daily forecast (free, no API key) — critical if rain probability ≥70% or wind ≥40km/h. Unlike every other check, this is date-scoped, not the usual "any open alert" dedup: a stale weather alert from a prior day is auto-resolved before checking, since a forecast alert is only ever about today.

`loadout_gap` is **not** implemented yet — it needs a link from a shift to a job type/loadout, which doesn't exist. A shift currently records crew + site + date only. Resolving this depends on the "jobs" concept already flagged as deferred in `documents.job_id` (see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#documents)).
