# openclaw/notifier/

Pushes **critical** management notifications (tool marked missing/retired, wrong-site, overdue, stalled order) to WhatsApp the moment the backend detects them — instead of waiting for the next fixed-time digest. See `docs/ARCHITECTURE.md`'s "Management notifications" section for why this runs here and not in the backend: the backend runs in Docker with no filesystem or network access to the `openclaw` binary/gateway, so delivery has to be initiated from this side, polling the backend's HTTP API (the direction that already works everywhere else in this repo).

`deliver-notifications.mjs` is dependency-free (global `fetch` + `node:child_process` only) — polls `GET /notifications/pending` (critical + undelivered), sends each via `openclaw message send --channel whatsapp`, then `PATCH`es it delivered on success. A failed send is left undelivered for the next poll, no extra retry bookkeeping.

**Routine** events (normal tool registration/verification, order progress, idle-crew flags) are never touched by this script — they're pulled separately by the digest agent's `list_notifications` tool, never pushed.

## Environment variables

- `BACKEND_URL` — defaults to `http://localhost:3000/api/v1`
- `AGENT_SERVICE_TOKEN` — **required**, the same value already configured for the backend and `fieldops-tools` plugin (see `docs/DEPLOYMENT.md`'s "Dashboard auth rollout" for where this token comes from — don't generate a new one)
- `MANAGEMENT_WHATSAPP_NUMBER` — **required**, E.164, e.g. `+15555550123`. Same recipient as the status digests for now; expanding to a second recipient/group chat is blocked on the same missing phone number/JID noted in the "Status digests" section, not something new here.
- `OPENCLAW_BIN` — defaults to `openclaw` (works fine interactively). A cron `--command` job's `sh -lc` doesn't necessarily source the same `PATH` as an interactive SSH session — if delivery fails with `spawnSync openclaw ENOENT` in `openclaw cron runs --id <id>`, set this to the absolute path (`which openclaw` in an interactive shell) in the job's `--command-env`.

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
