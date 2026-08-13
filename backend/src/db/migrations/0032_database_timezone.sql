-- Root-causes a bug class first caught in checkVehicleDark (backend/src/
-- workers/exceptions.ts): CURRENT_DATE and now() default to the session's
-- timezone, which was UTC -- so "today" and "shift start time" comparisons
-- silently drifted once local (America/Toronto) time crossed UTC's next
-- day, every evening. TIMESTAMPTZ columns are unaffected (Postgres always
-- stores those as UTC internally) -- this only changes how CURRENT_DATE,
-- now(), and date-arithmetic resolve "today" for new connections, matching
-- the same America/Toronto convention the digest cron jobs already use.
ALTER DATABASE fieldops SET timezone TO 'America/Toronto';
