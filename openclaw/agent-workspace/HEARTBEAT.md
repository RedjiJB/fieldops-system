<!-- Heartbeat template; comments-only content prevents scheduled heartbeat API calls. -->
<!-- Left unused on purpose: the status digests (morning/midday/evening) were built as three -->
<!-- `openclaw cron` jobs instead of the per-agent heartbeat mechanism, because heartbeat's -->
<!-- `every` field is an interval since last run (drifts, doesn't land on a fixed clock time) -->
<!-- while `cron` supports real cron expressions for exact daily times — see -->
<!-- ../README.md#status-digests for the job definitions. -->

# Keep this file empty (or with only comments) to skip heartbeat API calls.
