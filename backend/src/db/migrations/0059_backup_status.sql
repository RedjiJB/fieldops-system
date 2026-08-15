-- Tracks the nightly database backup's last outcome -- same singleton-row
-- convention as dashboard_url (0046_dashboard_url.sql). The pg_dump backup
-- documented in docs/DEPLOYMENT.md's "Backups" section had never actually
-- been installed on the Pi (confirmed: no crontab, no openclaw cron job, no
-- backup files anywhere) until this migration's companion script
-- (openclaw/notifier/backup-database.mjs) shipped -- this table is what
-- lets that silent gap become a visible, alertable one instead.
CREATE TABLE backup_status (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_size_bytes BIGINT,
  last_error      TEXT
);

-- Singleton by convention: exactly one row, seeded here, always UPDATEd
-- afterward -- see backend/src/routes/system.ts.
INSERT INTO backup_status DEFAULT VALUES;
