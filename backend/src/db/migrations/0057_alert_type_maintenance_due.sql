-- New alert for an asset whose service interval has elapsed -- see
-- backend/src/workers/exceptions.ts's checkMaintenanceDue(). Own migration
-- file: ALTER TYPE ... ADD VALUE can't share a transaction with other
-- statements (same constraint as prior alert_type additions).
ALTER TYPE alert_type ADD VALUE 'maintenance_due';
