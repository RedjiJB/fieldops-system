-- New alert for a scheduled agent job (cron) that failed to run -- see
-- backend/src/routes/system.ts's POST /system/cron-failure. Exists so a
-- cron failure (e.g. every configured model provider unreachable) raises a
-- clean, dashboard-visible alert instead of the automation platform's
-- default fallback: announcing the raw error text (agent directory paths,
-- auth store locations, re-authentication commands) straight to whichever
-- WhatsApp number the job's successful output would have gone to. Own
-- migration file: ALTER TYPE ... ADD VALUE can't share a transaction with
-- other statements (same constraint as prior alert_type additions).
ALTER TYPE alert_type ADD VALUE 'cron_job_failed';
