-- Own migration file: ALTER TYPE ... ADD VALUE can't share a transaction
-- with other statements. Raised by openclaw/notifier/heartbeat.mjs when
-- the Pi's disk free space drops below a threshold -- part of the same
-- "comprehensive IT monitoring" pass as connectivity_degraded (see
-- 0067's comment), filling a gap where nothing previously watched host
-- resource exhaustion at all.
ALTER TYPE alert_type ADD VALUE 'disk_space_low';
