<!-- Heartbeat template; comments-only content prevents scheduled heartbeat API calls. -->
<!-- Not wired up yet on purpose: the backend's own exceptions worker (backend/src/workers/exceptions.ts) -->
<!-- already runs on a timer and writes to the alerts table. Relaying unresolved alerts into WhatsApp -->
<!-- via a heartbeat would be a reasonable future step (list_alerts + resolved=false, on some interval), -->
<!-- but that's not built — don't assume it's happening until this file has real content. -->

# Keep this file empty (or with only comments) to skip heartbeat API calls.
