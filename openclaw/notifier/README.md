# openclaw/notifier/

Host-side scripts. All run here rather than in the backend because the backend's Docker container has no filesystem or network access to the `openclaw` binary/gateway — see `docs/ARCHITECTURE.md`'s "Management notifications" section. Most poll the backend's HTTP API and push via `openclaw message send`; `sync-dashboard-url.mjs` is the one exception (see below) — it needs real `docker` CLI access instead, for the same "backend container can't reach the host" reason, just a different host-level capability.

## `deliver-notifications.mjs`

Pushes **critical** management notifications (tool marked missing/retired, wrong-site, overdue, stalled order) to WhatsApp the moment the backend detects them, and escalates ones nobody's acknowledged. Dependency-free (global `fetch` + `node:child_process` only). Each run does two passes:

**Recipients are role-queried, not a fixed number.** `getRecipients()` first calls `GET /notification-settings` for `critical_notification_roles` (default `["management", "owner"]`, editable from the dashboard's Notification Settings page — no longer a hardcoded array in this script, see `docs/DATABASE_SCHEMA.md#notification-settings`), then `GET /crew-members?role=<role>&active=true` for each one, dedupes by phone, and sends to all of them. Registering a second management/owner crew member picks them up automatically — no config change needed either way. `foreman` is excluded by default (nothing site-scopes an alert to "their" site yet); add it via the settings page whenever that changes. If no active crew member has any of the configured roles, the run logs an error and does nothing that tick — there's nowhere to deliver to.

1. **First push**: `GET /notifications/pending` (critical + undelivered + `send_attempts < 5`), sends to every recipient via `openclaw message send --channel whatsapp --json`, best-effort captures the *first* successful send's message id (field name unconfirmed — see the "Live reply-id check" note below). Right after a successful send, `PATCH`es `/attempt` (increments `send_attempts`) *before* attempting `PATCH /delivered` — deliberately two separate calls, so the attempt still counts even if marking delivered then fails. A notification with zero successful sends is left undelivered for the next poll, no attempt recorded. **One `notifications` row still means one `delivered_at`/`whatsapp_message_id`/`acknowledged_by`, even with multiple recipients** — whoever acknowledges first (on any recipient's phone) clears it for the whole team. This is the same "management as a unit" semantics the schema always had (there was only ever one recipient before), not a new limitation introduced by multi-recipient delivery; true per-recipient acknowledgment tracking would need a separate `notification_deliveries` table, out of scope for now.
2. **Escalation**: `GET /notifications/escalation-candidates` (critical, delivered, still unacknowledged for `escalation_threshold_minutes`+ minutes, escalated fewer than `max_escalations` times — both defaults 20/3, also now settings-backed rather than hardcoded), re-sends each prefixed "⏰ Still needs attention" to every recipient, `PATCH`es `/escalate`.

**Real incident, confirmed live (2026-08-14) and fixed:** a genuine `dashboard_unreachable` alert's notification got re-sent every single cron tick (every 1 minute) for over an hour to real management contacts. Root cause was two compounding bugs. First, `backendFetch` here reuses Node's default keep-alive connection pool, and `sendWhatsApp`'s blocking `execFileSync` call can easily run past the backend's 5-second Keep-Alive timeout — the next request (marking the notification delivered) tried to reuse the now-stale socket and failed with a bare `fetch failed`, so the row never left the pending queue. Fixed by sending `Connection: close` on every request; a short-lived cron script gains nothing from connection reuse anyway. Second — and this is what made the first bug spam instead of just retry once — the first-push loop had no attempt cap at all (only escalations did), so a failure here retried forever with no backstop. `send_attempts`/`/notifications/:id/attempt` (above) closes that gap generically, not just for this one root cause: even a different, not-yet-known future bug in the delivered-marking path now runs out after 5 attempts instead of resending indefinitely.

**Routine** events (normal tool registration/verification, order progress, idle-crew flags) are never touched by this script — they're pulled separately by the digest agent's `list_notifications` tool, never pushed.

**Acknowledgment** happens via the agent (a WhatsApp reply resolved through `list_notifications`/`acknowledge_notification` — see `AGENTS.md`'s "Acknowledging critical notifications") or the dashboard, not this script.

## `nudge-shifts.mjs`

Runs once daily, evening before, and messages each crew member directly (not management) whose shift for tomorrow is still `status=assigned`: `GET /shifts?date=<tomorrow>&status=assigned`, skips anything with `nudged_at` already set or no phone on file, sends a "reply CONFIRM or DECLINE" message to `shift.crew_member_phone`, then `PATCH /shifts/:id/nudged`. The reply lands as a normal inbound message the agent already routes to the existing `confirm_shift` tool — no new correlation logic needed for this one.

## `deliver-confirmation-outcomes.mjs`

Same shape as `nudge-shifts.mjs` (targets the crew member directly, not management), but polls continuously (~1min, same cadence as `deliver-notifications.mjs`) rather than once daily: `GET /pending-confirmations/unnotified` (`status IN ('approved','rejected','expired') AND crew_notified_at IS NULL`), sends a plain-language outcome message to `crew_member_phone`, `PATCH /pending-confirmations/:id/mark-notified`. This is the "tell the crew member the outcome" half of the two-party confirm-before-execute pilot (see `AGENTS.md`'s "Two-party confirm-before-execute" section and `docs/DATABASE_SCHEMA.md#confirmations`) — the crew member doesn't need to check back after submitting one of the four gated tool calls, this delivers the decision proactively once management (or a timeout) resolves it.

## `sync-dashboard-url.mjs`

Runs every 5 minutes, keeps `dashboard_url` (Postgres) fresh with the current Cloudflare Quick Tunnel URL. Doesn't call `openclaw message send` at all — no WhatsApp involved, this one only needs `docker` CLI access (no container in this stack has a `docker.sock` mount) and the backend's HTTP API. `execFileSync("docker", ["compose", "logs", "cloudflared"])` — no `--tail` limit, deliberately: an earlier version used `--tail 50`, and a real flapping episode generated enough reconnect-churn log noise (INF/ERR retry lines) to push the one-time URL banner out of that window within minutes, permanently forcing a false "unreachable" until the container restarted, even once the tunnel had actually recovered. The service's own `logging:` block (`max-size: 10m, max-file: 3`) already bounds total volume, so reading everything buffered is cheap. Extracts the last `https://*.trycloudflare.com` match (logs accumulate across restarts — always the last one, not the first), does a `HEAD` request to confirm it's actually serving, then `PATCH /system/dashboard-url` (if a URL was found) and `POST /system/dashboard-url/health` (always) — see `docs/API.md`'s System section and `docs/DATABASE_SCHEMA.md#dashboard_url`.

Also invoked directly (not via cron) by the agent's `restart_dashboard_tunnel` tool right after it restarts the `cloudflared` container — same script either way, no separate logic kept in sync.

Built after the tunnel silently died for ~30 hours with nothing to catch it — see `docs/ARCHITECTURE.md`'s Hosting section.

## `backup-database.mjs`

Runs nightly, `docker compose exec -T postgres pg_dump -U fieldops fieldops`, gzips the output, writes it to `~/fieldops-backups/` (deliberately outside the repo working directory — a dump should never be able to land inside a git-tracked directory), prunes anything older than 14 days, then `POST /system/backup-status` with the outcome. Same `docker` CLI dependency as `sync-dashboard-url.mjs`, no `openclaw` binary involved.

Built after discovering `docs/DEPLOYMENT.md`'s previously-documented crontab-based nightly backup had never actually been installed anywhere on the live Pi — no crontab, no backup files, silently absent the whole time this deployment existed. `backup_status.last_success_at` (see `docs/DATABASE_SCHEMA.md#backup_status`) not advancing is exactly what that same failure mode looks like from Postgres's side, which is what the exceptions worker's `checkBackupStale` watches for — see `docs/EXCEPTION_HANDLING.md`.

## `sync-model-usage.mjs`

Runs nightly, scans every `~/.openclaw/agents/*/sessions/*.jsonl` transcript file for assistant messages with a `usage` block (already present on every turn -- this script only aggregates, it captures nothing new), sums input/output/cache/reasoning tokens and cost by (local date, provider, model) over a rolling lookback window (`MODEL_USAGE_LOOKBACK_DAYS`, default 90), and `POST /system/model-usage`s the whole recomputed set. Stateless -- no "already processed" offset tracked, the full window is recomputed and `UPSERT`ed every run, which is simpler and self-healing at the cost of some redundant work each run (cheap at this scale). Dates are computed in `MODEL_USAGE_TZ` (default `America/Toronto`, matching the IANA timezone this stack's other cron jobs are already declared against), not UTC -- a turn near local midnight needs to land on the day the business experienced it, same class of bug `0032_database_timezone.sql` fixed for the exceptions worker's own checks.

Built after realizing every agent turn already returns full token/cost usage, but nothing persisted it anywhere queryable -- `openclaw audit`'s own event log is deliberately `metadata_only` (no usage/cost fields), confirmed by inspecting it directly; the real numbers only ever lived inside each session's own transcript file.

## Environment variables

- `BACKEND_URL` — defaults to `http://localhost:3000/api/v1`
- `AGENT_SERVICE_TOKEN` — **required**, the same value already configured for the backend and `fieldops-tools` plugin (see `docs/DEPLOYMENT.md`'s "Dashboard auth rollout" for where this token comes from — don't generate a new one)
- `OPENCLAW_BIN` — defaults to `openclaw` (works fine interactively). A cron `--command` job's `sh -lc` doesn't necessarily source the same `PATH` as an interactive SSH session — if delivery fails with `spawnSync openclaw ENOENT` in `openclaw cron runs --id <id>`, set this to the absolute path (`which openclaw` in an interactive shell) in the job's `--command-env`. Not needed by `sync-dashboard-url.mjs` — it never calls the `openclaw` binary, only `docker` and `fetch`.
- `FIELDOPS_REPO_DIR` — `sync-dashboard-url.mjs` only, defaults to `$HOME/fieldops-system`. Working directory for `docker compose logs cloudflared`.

## Install

Runs as an `openclaw cron` job (same store as the three digest jobs — not in this repo, won't survive a Pi reprovision, recreate with this command):

```bash
openclaw cron add --name fieldops-notifier --display-name "Management Notification Delivery" \
  --command "node ~/fieldops-system/openclaw/notifier/deliver-notifications.mjs" \
  --command-env "AGENT_SERVICE_TOKEN=<real token>" \
  --command-env "OPENCLAW_BIN=$(which openclaw)" \
  --every 1m --timeout-seconds 30 --no-deliver
```

Replace `<real token>` with the real `AGENT_SERVICE_TOKEN` value — never commit it. `$(which openclaw)` bakes in the absolute path at creation time — needed because a cron `--command` job's shell doesn't necessarily have the same `PATH` as an interactive session (see `OPENCLAW_BIN` above). `--no-deliver` stops the cron runner from separately trying to "announce" the command's own stdout to a chat — delivery already happens inside the script via explicit `openclaw message send` calls, so the runner's own delivery attempt is redundant and fails closed with no route configured anyway.

Verify with `openclaw cron run <id>` (runs it immediately without waiting for the schedule) and `openclaw cron runs --id <id>` (actual stdout/stderr and error detail — `openclaw cron list`'s status column alone isn't enough to tell whether the script's own logic succeeded, since a *cron-level* delivery failure and a *script-level* delivery failure can look identical in one line).

`nudge-shifts.mjs` installs the same way, once daily instead of every minute — target is per-shift, resolved from `crew_members.phone`, not role-queried like `deliver-notifications.mjs`:

```bash
openclaw cron add --name fieldops-shift-nudge --display-name "Shift Confirmation Nudges" \
  --command "node ~/fieldops-system/openclaw/notifier/nudge-shifts.mjs" \
  --command-env "AGENT_SERVICE_TOKEN=<real token>" \
  --command-env "OPENCLAW_BIN=$(which openclaw)" \
  --cron "0 18 * * *" --timeout-seconds 60 --no-deliver
```

`deliver-confirmation-outcomes.mjs` installs like `deliver-notifications.mjs` (every minute) — per-crew-member target though, same as `nudge-shifts.mjs`, not role-queried:

```bash
openclaw cron add --name fieldops-confirmation-outcomes --display-name "Confirmation Outcome Delivery" \
  --command "node ~/fieldops-system/openclaw/notifier/deliver-confirmation-outcomes.mjs" \
  --command-env "AGENT_SERVICE_TOKEN=<real token>" \
  --command-env "OPENCLAW_BIN=$(which openclaw)" \
  --every 1m --timeout-seconds 30 --no-deliver
```

`sync-dashboard-url.mjs` installs every 5 minutes, no `OPENCLAW_BIN` needed (it never calls the `openclaw` binary):

```bash
openclaw cron add --name fieldops-dashboard-url-sync --display-name "Dashboard URL Sync" \
  --command "node ~/fieldops-system/openclaw/notifier/sync-dashboard-url.mjs" \
  --command-env "AGENT_SERVICE_TOKEN=<real token>" \
  --every 5m --timeout-seconds 30 --no-deliver
```

`backup-database.mjs` installs nightly, same no-`OPENCLAW_BIN` reasoning as `sync-dashboard-url.mjs`:

```bash
openclaw cron add --name fieldops-backup --display-name "Database Backup" \
  --command "node ~/fieldops-system/openclaw/notifier/backup-database.mjs" \
  --command-env "AGENT_SERVICE_TOKEN=<real token>" \
  --cron "0 3 * * *" --timeout-seconds 300 --no-deliver
```

`sync-model-usage.mjs` installs nightly too, no `OPENCLAW_BIN` needed (no `openclaw`/`docker` CLI involved, just filesystem reads and `fetch`):

```bash
openclaw cron add --name fieldops-model-usage --display-name "Model Usage Sync" \
  --command "node ~/fieldops-system/openclaw/notifier/sync-model-usage.mjs" \
  --command-env "AGENT_SERVICE_TOKEN=<real token>" \
  --cron "30 3 * * *" --timeout-seconds 120 --no-deliver
```

## Live reply-id check (do once, not blocking)

Whether `openclaw message send --json`'s message id matches the `stanzaId`/`replyToId` a later quote-reply shows is unverified as of this writing (the WhatsApp channel plugin's source isn't installed anywhere this repo's been developed to check directly). To confirm: send a real critical notification, note what `deliver-notifications.mjs`'s log shows it captured as `whatsapp_message_id` (or run `openclaw message send ... --json` manually and inspect the raw output), quote-reply to that WhatsApp message, and check the next agent turn's visible `[Replying to ... id:...]` text against it. Acknowledgment works either way — see `AGENTS.md` — this just confirms whether the id-match path (faster, no disambiguation needed) actually fires, or whether it's silently falling through to the "exactly one open critical" heuristic every time.
