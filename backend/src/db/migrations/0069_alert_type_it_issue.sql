-- Own migration file: ALTER TYPE ... ADD VALUE can't share a transaction
-- with other statements. Crew-reported IT/system problems (dashboard
-- broken, WhatsApp bot acting up, etc.) via the new report_it_issue agent
-- tool -- the only other crew-initiated critical alert today is
-- report_safety_incident, which is physical-safety-only and bypasses the
-- alerts table entirely (a one-off report with nothing to resolve). An IT
-- issue benefits from being resolvable/trackable through the existing
-- resolve_alert tool like every other alert type, so this one goes
-- through raiseAlert normally rather than copying safety-report's bypass.
ALTER TYPE alert_type ADD VALUE 'it_issue';
