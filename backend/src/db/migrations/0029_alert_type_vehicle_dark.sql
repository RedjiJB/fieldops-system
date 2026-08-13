-- New alert for a vehicle that was actively reporting telemetry today and
-- has since gone quiet during an active shift -- see
-- backend/src/workers/exceptions.ts's checkVehicleDark(). Own migration
-- file: ALTER TYPE ... ADD VALUE can't share a transaction with other
-- statements (same constraint as 0019_shift_status_declined.sql).
ALTER TYPE alert_type ADD VALUE 'vehicle_dark';
