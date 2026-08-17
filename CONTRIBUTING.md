# Contributing

This is a small, single-crew POC (see [README.md](README.md) and [docs/ROADMAP.md](docs/ROADMAP.md)), not a public open-source project — but the conventions below are what's kept 125+ commits of fast iteration from rotting, and they matter more here than in a bigger, slower-moving codebase. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first if you haven't; it explains the shape everything below assumes.

## Prerequisites

- Node.js 24+ (`node -v`)
- Docker + Docker Compose (Postgres, backend, and — in production — `cloudflared` all run as containers; see [docker-compose.yml](docker-compose.yml))
- The [OpenClaw](https://docs.openclaw.ai) CLI, if you're touching the agent, plugins, or notifier scripts — it does **not** run in Docker (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)'s "Installing OpenClaw"), and several `npm run` scripts in `openclaw/plugins/*` shell out to it (`plugin:build`, `plugin:validate`)

## Local dev loop

```bash
cp .env.example .env        # fill in real values — see docs/DEPLOYMENT.md
docker compose up -d postgres
cd backend && npm install && npm run migrate && npm run dev   # tsx watch, not the compiled dist
```

The frontend and each plugin are independent npm workspaces (not a monorepo tool — just separate `package.json`s), run from their own directories:

```bash
cd frontend && npm install && npm run dev            # vite dev server
cd openclaw/plugins/fieldops-tools && npm install && npm run build   # tsc; rerun after any src/ change
```

A plugin's `dist/` is what OpenClaw actually loads — `npm run build` alone does not update the running gateway's copy of it. See "Deploying" below.

## Migrations

`backend/src/db/migrations/NNNN_description.sql`, four-digit zero-padded, sequential, never renumbered or edited after being committed (the runner tracks applied filenames in `schema_migrations` — see `backend/src/db/migrate.ts` — so an edited already-applied file silently diverges from what's actually in the database). `npm run migrate` applies whatever hasn't run yet, in filename order, each in its own transaction.

Two real gotchas, both hit and fixed during this project:

- **`ALTER TYPE ... ADD VALUE` cannot share a transaction with other statements.** Postgres enforces this at the transaction level, and the migration runner wraps every file in one transaction — so a new enum value always gets its own migration file, never bundled with the table/column change that uses it (see `0078_alert_type_crew_location_stale.sql` and `0079_alert_type_crew_off_site.sql` for the pattern: two files, one value each, even though they landed in the same feature).
- **Restarting a container with new code before running migrations is a real race, not just a theoretical one.** A worker whose first tick fires immediately on startup (not just on its interval — see `startExceptionsWorker` in `backend/src/workers/exceptions.ts`) will throw `relation "..." does not exist` if the new table isn't there yet. Always `npm run migrate` before restarting a container that depends on the new schema, not after.

## Testing

There's no backend unit-test suite — `npx tsc --noEmit` (strict mode is on) is the safety net for the backend, plus the layers below for actual behavior:

- **Plugin unit tests** (`openclaw/plugins/*/src/index.test.ts`, run via `npm test` / `vitest run` in each plugin directory): mostly manifest-shape checks today — e.g. `fieldops-tools`' test asserts the exact declared tool-name order. **This list is not auto-derived — it's hand-maintained, and it silently drifts whenever a tool is added, removed, or reordered in `src/index.ts` without a matching edit here.** Update it in the same change that changes the tool list, and run the test before considering that change done — don't assume a prior session already did it.
- **Agent-tests** (`openclaw/agent-tests/`, `npm test`): shells out to the real `openclaw agent` CLI for one live turn per scenario, against the real gateway and model, asserting on which tools got called and what the reply said. **Deliberately never passes `--deliver`** (see `src/runAgent.ts`'s header comment) — nothing in this suite is meant to reach a real WhatsApp chat. It needs the `openclaw` binary and a reachable backend, so in practice it runs over SSH on the Pi, not on a dev laptop. Before adding a new scenario, check that it doesn't exercise a tool that actually sends on approval — `resolve_message_draft` with `action: "approve"` and `send_dashboard_login_link` both really deliver; a scenario that calls either of those isn't a safe addition to this suite as it stands.
- **Plugin manifest validation**: `npm run plugin:validate` (wraps `openclaw plugins build` + `openclaw plugins validate`) — confirms the compiled `dist/index.js` actually exposes the tool metadata OpenClaw expects. Run this after any tool addition/removal, not just the build.
- **API smoke tests**: no automated harness for this yet — the established pattern (see any of the later `git log` entries with "Deploy + verify") is a manual `curl` sweep against the live Pi backend after a deploy, exercising the new/changed routes directly.

**QA test data, not real crew, for anything mutating.** The established pattern all session: create an obviously-disposable crew member (e.g. `name: "QA Test Crew"`, an out-of-range phone like `+10000000001`) and/or site (`name: "QA Test..."`) for any live test that writes data, then delete every row it touched afterward and confirm with a `count(*) ... WHERE name LIKE 'QA Test%'` returning 0. Never mutate a real crew member's real record to test something. Watch foreign-key ordering on cleanup — e.g. a `pending_confirmations` row referencing a test notification/crew member has to go before the rows it references.

**Never send a real WhatsApp message as a side effect of testing.** `resolve_message_draft` (approve path), `send_dashboard_login_link`, and any notifier script run manually against real (non-QA) crew/shift data all really deliver. Test the logic up to that boundary — draft creation, rejection, route/DB state — without crossing it.

## Deploying

Deploys are git-based, not CI/CD — there's no pipeline, just a disciplined manual sequence (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the one-time setup this assumes):

1. Push to `main`.
2. On the Pi: `git fetch origin -q && git reset --hard origin/main`.
3. **Migrate before restarting anything** (see the race above): `docker compose exec backend npm run migrate` — or, if the backend image itself changed, build first, migrate, then bring the new container up (never restart-then-migrate).
4. Rebuild whatever actually changed: `docker compose build backend frontend && docker compose up -d backend frontend`. A running container is a build-time filesystem snapshot — copying a changed file into a running container's volume doesn't work here, there's no bind mount for source in production.
5. If a plugin changed: `npm run build && npx openclaw plugins build --entry ./dist/index.js && npx openclaw plugins validate --entry ./dist/index.js` in the plugin directory, then restart the gateway (`systemctl --user restart openclaw-gateway` or the equivalent `openclaw` command) so it picks up the new `dist/`.
6. If a notifier script or its cron schedule changed: `openclaw cron list` / `openclaw cron add` / `openclaw cron run <id>` as needed — see `openclaw/notifier/README.md`'s "Install" section for every script's exact install command.
7. Verify live — a real `curl` against the new route, or the QA-data pattern above for anything mutating. Docs-only changes just need the `git reset --hard` sync, no rebuild.

Docs-only changes still get committed and pushed like code — this repo documents each feature in the same session it's built, not as a later cleanup pass (see [CHANGELOG.md](CHANGELOG.md) for the pattern in practice).

## Conventions

- **No fabricated data, ever** — not crew, not shifts, not sites, not schedule entries, not test results. If real data doesn't exist yet for something (e.g. an unscheduled day), say so plainly rather than inventing a plausible-looking placeholder. This was a repeated, explicitly corrected failure mode earlier in this project and is the single most important rule in this repo.
- **Confirm before execute, and now, confirm before *send*.** Any tool that moves inventory, money, or a schedule already required a human-facing confirm/reject round-trip; `pending_confirmations` adds a *second* party's sign-off for the highest-trust subset (see `docs/ARCHITECTURE.md`'s design principle 3). Every proactive, agent-initiated outbound message (a digest, a role broadcast — not an ordinary reply) goes through the `message_drafts` review queue and needs IT's explicit approval before it sends — see `create_message_draft` / `resolve_message_draft` in `openclaw/plugins/fieldops-tools`. A new proactive-notification feature that sends directly instead of drafting first is a regression of this rule, not a shortcut.
- **Comments explain WHY, not WHAT.** The codebase default is no comments; the ones that exist almost all document a non-obvious constraint, a workaround for a specific confirmed bug, or a reviewer-facing "we tried the obvious thing and it didn't work" note. If you'd remove a comment and nothing would be lost, it shouldn't have been added.
- **Reuse existing helpers instead of re-deriving them.** This project has a real track record of doing this deliberately — `haversineDistanceMeters` (`backend/src/lib/geo.ts`) backs both vehicle and crew geofence checks; `crew_telemetry` mirrors `vehicle_telemetry`'s shape instead of inventing a different one; `pending_confirmations`' two-party pattern was reused for shift extensions rather than a new table. Before adding a new table/helper/pattern, check whether an existing one already fits.
- **Migration files and their matching schema doc updates land in the same change.** `docs/DATABASE_SCHEMA.md`, `docs/API.md`, and `docs/ARCHITECTURE.md` get updated in the same session a feature is built, not deferred — see `git log` for the pattern (a feature commit is very often followed immediately by a "Docs: ..." or a bundled docs update in the same commit).
- **Commit messages**: imperative, sentence case, no enforced prefix convention, but a security-relevant fix says so explicitly ("Security fix: ...", "SECURITY: ...") rather than burying it in a generic description — this repo's changelog and security posture both depend on that being searchable. See [CHANGELOG.md](CHANGELOG.md) for the accumulated style in practice.
