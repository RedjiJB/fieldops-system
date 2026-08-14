# openclaw/notifier/

Host-side scripts. All run here rather than in the backend because the backend's Docker container has no filesystem or network access to the `openclaw` binary/gateway — see `docs/ARCHITECTURE.md`'s "Management notifications" section. Most poll the backend's HTTP API and push via `openclaw message send`; `sync-dashboard-url.mjs` is the one exception (see below) — it needs real `docker` CLI access instead, for the same "backend container can't reach the host" reason, just a different host-level capability.

## `deliver-notifications.mjs`

Pushes **critical** management notifications (tool marked missing/retired, wrong-site, overdue, stalled order) to WhatsApp the moment the backend detects them, and escalates ones nobody's acknowledged. Dependency-free (global `fetch` + `node:child_process` only). Each run does two passes:

1. **First push**: `GET /notifications/pending` (critical + undelivered), sends each via `openclaw message send --channel whatsapp --json`, best-effort captures the sent message's id (field name unconfirmed — see the "Live reply-id check" note below), `PATCH`es it delivered. A failed send is left undelivered for the next poll, no extra retry bookkeeping.
2. **Escalation**: `GET /notifications/escalation-candidates` (critical, delivered, still unacknowledged for 20+ minutes, escalated fewer than 3 times), re-sends each prefixed "⏰ Still needs attention", `PATCH`es `/escalate`. Capped at 3 so a genuinely unreachable recipient doesn't get spammed forever.

**Routine** events (normal tool registration/verification, order progress, idle-crew flags) are never touched by this script — they're pulled separately by the digest agent's `list_notifications` tool, never pushed.

**Acknowledgment** happens via the agent (a WhatsApp reply resolved through `list_notifications`/`acknowledge_notification` — see `AGENTS.md`'s "Acknowledging critical notifications") or the dashboard, not this script.

## `nudge-shifts.mjs`

Runs once daily, evening before, and messages each crew member directly (not management) whose shift for tomorrow is still `status=assigned`: `GET /shifts?date=<tomorrow>&status=assigned`, skips anything with `nudged_at` already set or no phone on file, sends a "reply CONFIRM or DECLINE" message to `shift.crew_member_phone`, then `PATCH /shifts/:id/nudged`. The reply lands as a normal inbound message the agent already routes to the existing `confirm_shift` tool — no new correlation logic needed for this one.

## `deliver-confirmation-outcomes.mjs`

Same shape as `nudge-shifts.mjs` (targets the crew member directly, not management), but polls continuously (~1min, same cadence as `deliver-notifications.mjs`) rather than once daily: `GET /pending-confirmations/unnotified` (`status IN ('approved','rejected','expired') AND crew_notified_at IS NULL`), sends a plain-language outcome message to `crew_member_phone`, `PATCH /pending-confirmations/:id/mark-notified`. This is the "tell the crew member the outcome" half of the two-party confirm-before-execute pilot (see `AGENTS.md`'s "Two-party confirm-before-execute" section and `docs/DATABASE_SCHEMA.md#confirmations`) — the crew member doesn't need to check back after submitting one of the four gated tool calls, this delivers the decision proactively once management (or a timeout) resolves it.

## `sync-dashboard-url.mjs`

Runs every 5 minutes, keeps `dashboard_url` (Postgres) fresh with the current Cloudflare Quick Tunnel URL. Doesn't call `openclaw message send` at all — no WhatsApp involved, this one only needs `docker` CLI access (no container in this stack has a `docker.sock` mount) and the backend's HTTP API. `execFileSync("docker", ["compose", "logs", "--tail", "50", "cloudflared"])`, extracts the last `https://*.trycloudflare.com` match (logs accumulate across restarts — always the last one, not the first), does a `HEAD` request to confirm it's actually serving, then `PATCH /system/dashboard-url` (if a URL was found) and `POST /system/dashboard-url/health` (always) — see `docs/API.md`'s System section and `docs/DATABASE_SCHEMA.md#dashboard_url`.

Also invoked directly (not via cron) by the agent's `restart_dashboard_tunnel` tool right after it restarts the `cloudflared` container — same script either way, no separate logic kept in sync.

Built after the tunnel silently died for ~30 hours with nothing to catch it — see `docs/ARCHITECTURE.md`'s Hosting section.

## Environment variables

- `BACKEND_URL` — defaults to `http://localhost:3000/api/v1`
- `AGENT_SERVICE_TOKEN` — **required**, the same value already configured for the backend and `fieldops-tools` plugin (see `docs/DEPLOYMENT.md`'s "Dashboard auth rollout" for where this token comes from — don't generate a new one)
- `MANAGEMENT_WHATSAPP_NUMBER` — **required**, E.164, e.g. `+15555550123`. Same recipient as the status digests for now; expanding to a second recipient/group chat is blocked on the same missing phone number/JID noted in the "Status digests" section, not something new here.
- `OPENCLAW_BIN` — defaults to `openclaw` (works fine interactively). A cron `--command` job's `sh -lc` doesn't necessarily source the same `PATH` as an interactive SSH session — if delivery fails with `spawnSync openclaw ENOENT` in `openclaw cron runs --id <id>`, set this to the absolute path (`which openclaw` in an interactive shell) in the job's `--command-env`. Not needed by `sync-dashboard-url.mjs` — it never calls the `openclaw` binary, only `docker` and `fetch`.
- `FIELDOPS_REPO_DIR` — `sync-dashboard-url.mjs` only, defaults to `$HOME/fieldops-system`. Working directory for `docker compose logs cloudflared`.

## Install

Runs as an `openclaw cron` job (same store as the three digest jobs — not in this repo, won't survive a Pi reprovision, recreate with this command):

```bash
openclaw cron add --name fieldops-notifier --display-name "Management Notification Delivery" \
  --command "node ~/fieldops-system/openclaw/notifier/deliver-notifications.mjs" \
  --command-env "AGENT_SERVICE_TOKEN=<real token>" \
  --command-env "MANAGEMENT_WHATSAPP_NUMBER=+18193196405" \
  --command-env "OPENCLAW_BIN=$(which openclaw)" \
  --every 1m --timeout-seconds 30 --no-deliver
```

Replace `<real token>` with the real `AGENT_SERVICE_TOKEN` value — never commit it. `$(which openclaw)` bakes in the absolute path at creation time — needed because a cron `--command` job's shell doesn't necessarily have the same `PATH` as an interactive session (see `OPENCLAW_BIN` above). `--no-deliver` stops the cron runner from separately trying to "announce" the command's own stdout to a chat — delivery already happens inside the script via explicit `openclaw message send` calls, so the runner's own delivery attempt is redundant and fails closed with no route configured anyway.

Verify with `openclaw cron run <id>` (runs it immediately without waiting for the schedule) and `openclaw cron runs --id <id>` (actual stdout/stderr and error detail — `openclaw cron list`'s status column alone isn't enough to tell whether the script's own logic succeeded, since a *cron-level* delivery failure and a *script-level* delivery failure can look identical in one line).

`nudge-shifts.mjs` installs the same way, once daily instead of every minute, and doesn't need `MANAGEMENT_WHATSAPP_NUMBER` (the target is per-shift, resolved from `crew_members.phone`):

```bash
openclaw cron add --name fieldops-shift-nudge --display-name "Shift Confirmation Nudges" \
  --command "node ~/fieldops-system/openclaw/notifier/nudge-shifts.mjs" \
  --command-env "AGENT_SERVICE_TOKEN=<real token>" \
  --command-env "OPENCLAW_BIN=$(which openclaw)" \
  --cron "0 18 * * *" --timeout-seconds 60 --no-deliver
```

`deliver-confirmation-outcomes.mjs` installs like `deliver-notifications.mjs` (every minute), also without `MANAGEMENT_WHATSAPP_NUMBER` (per-crew-member target, same as `nudge-shifts.mjs`):

```bash
openclaw cron add --name fieldops-confirmation-outcomes --display-name "Confirmation Outcome Delivery" \
  --command "node ~/fieldops-system/openclaw/notifier/deliver-confirmation-outcomes.mjs" \
  --command-env "AGENT_SERVICE_TOKEN=<real token>" \
  --command-env "OPENCLAW_BIN=$(which openclaw)" \
  --every 1m --timeout-seconds 30 --no-deliver
```

`sync-dashboard-url.mjs` installs every 5 minutes, no `MANAGEMENT_WHATSAPP_NUMBER` or `OPENCLAW_BIN` needed:

```bash
openclaw cron add --name fieldops-dashboard-url-sync --display-name "Dashboard URL Sync" \
  --command "node ~/fieldops-system/openclaw/notifier/sync-dashboard-url.mjs" \
  --command-env "AGENT_SERVICE_TOKEN=<real token>" \
  --every 5m --timeout-seconds 30 --no-deliver
```

## Live reply-id check (do once, not blocking)

Whether `openclaw message send --json`'s message id matches the `stanzaId`/`replyToId` a later quote-reply shows is unverified as of this writing (the WhatsApp channel plugin's source isn't installed anywhere this repo's been developed to check directly). To confirm: send a real critical notification, note what `deliver-notifications.mjs`'s log shows it captured as `whatsapp_message_id` (or run `openclaw message send ... --json` manually and inspect the raw output), quote-reply to that WhatsApp message, and check the next agent turn's visible `[Replying to ... id:...]` text against it. Acknowledgment works either way — see `AGENTS.md` — this just confirms whether the id-match path (faster, no disambiguation needed) actually fires, or whether it's silently falling through to the "exactly one open critical" heuristic every time.
