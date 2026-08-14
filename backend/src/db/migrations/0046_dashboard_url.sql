-- Tracks the current Cloudflare Quick Tunnel URL for the web dashboard and
-- whether it's currently reachable -- Quick Tunnel mode mints a new random
-- URL on every restart and has no uptime guarantee (see docker-compose.yml's
-- cloudflared service). openclaw/notifier/sync-dashboard-url.mjs is the only
-- writer; the agent's get_dashboard_url tool is the only reader.
CREATE TABLE dashboard_url (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  reachable BOOLEAN NOT NULL DEFAULT true,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Singleton by convention: exactly one row, seeded here, always UPDATEd
-- afterward (never inserted into again) -- see backend/src/routes/system.ts.
INSERT INTO dashboard_url (url, reachable) VALUES ('', false);
