# scripts/

One-off tooling that doesn't belong in the main backend service.

Empty as of v1 — neither of the two scripts originally planned here got built in this form:
- QR tag generation for the bootstrap inventory audit didn't end up needing dedicated tooling in this repo.
- The nightly backup script exists, but landed at [openclaw/notifier/backup-database.mjs](../openclaw/notifier/backup-database.mjs) instead of here — it needs the same `openclaw cron`/`AGENT_SERVICE_TOKEN` conventions as every other notifier script (see that directory's README), which didn't fit a standalone `scripts/` shell script. See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md)'s "Backups" section for the install command.

If genuinely one-off tooling (unrelated to the notifier's cron conventions) comes up later, it belongs here.
