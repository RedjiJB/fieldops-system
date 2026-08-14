-- Fixes a real cooldown bug: restart_dashboard_tunnel's 5-minute cooldown
-- was checking checked_at, which sync-dashboard-url.mjs's routine 5-minute
-- cron poll also touches on every run -- meaning the tool treated "the
-- cron just health-checked it" as "we just restarted it," and would
-- refuse to restart almost indefinitely. last_restarted_at is set only
-- when a genuine restart happens (see POST /system/dashboard-url/health's
-- optional {restarted: true}, called only by the tool's own post-restart
-- sync invocation, never by the routine cron run).
ALTER TABLE dashboard_url ADD COLUMN last_restarted_at TIMESTAMPTZ;
