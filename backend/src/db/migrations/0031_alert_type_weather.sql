-- New alert for a job site with a confirmed shift today whose forecast
-- crosses the rain-probability/wind-speed thresholds -- see
-- backend/src/workers/exceptions.ts's checkWeather(). Own migration file:
-- ALTER TYPE ... ADD VALUE can't share a transaction with other statements
-- (same constraint as prior alert_type additions).
ALTER TYPE alert_type ADD VALUE 'weather';
