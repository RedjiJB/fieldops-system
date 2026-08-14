-- New alert for when the dashboard's Cloudflare Quick Tunnel URL fails its
-- health check -- see backend/src/routes/system.ts's POST
-- /system/dashboard-url/health. Own migration file: ALTER TYPE ... ADD
-- VALUE can't share a transaction with other statements (same constraint
-- as prior alert_type additions, e.g. 0031_alert_type_weather.sql).
ALTER TYPE alert_type ADD VALUE 'dashboard_unreachable';
