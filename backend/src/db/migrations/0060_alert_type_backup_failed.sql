-- New alert for a database backup that either explicitly failed or has
-- gone stale (no success recorded recently) -- see
-- backend/src/workers/exceptions.ts's checkBackupStale(). Own migration
-- file: ALTER TYPE ... ADD VALUE can't share a transaction with other
-- statements (same constraint as prior alert_type additions).
ALTER TYPE alert_type ADD VALUE 'backup_failed';
