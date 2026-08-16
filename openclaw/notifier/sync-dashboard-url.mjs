#!/usr/bin/env node
// Runs every 5 minutes on the Pi host, same reasoning as deliver-notifications.mjs:
// the backend can't reach the host directly, and (formerly) this needed real
// `docker` CLI access to read cloudflared's logs -- kept as a host script for
// consistency with its siblings even though the docker dependency below is gone.
//
// The stack now runs a NAMED Cloudflare tunnel on a real domain
// (dashboard.sodboysltd.org, see docker-compose.yml's cloudflared service),
// not Quick Tunnel mode. A named tunnel's hostname is configured cloud-side
// and is stable across restarts -- it never prints a *.trycloudflare.com URL
// banner to discover, so this script no longer scrapes `docker compose logs`
// for one (that approach is dead code under the current setup: cloudflared
// simply never logs a matching line, so the old version's cached URL would
// freeze forever at whatever it last saw before the cutover -- confirmed live,
// see docs/ARCHITECTURE.md's Hosting section). Instead this just confirms the
// known, fixed URL is actually serving and reports that.
//
// Also invoked directly (not via cron) by the agent's restart_dashboard_tunnel
// tool, right after it restarts the container -- same script either way, no
// separate logic to keep in sync.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000/api/v1";
const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN;
// The stable, named-tunnel hostname. Overridable (e.g. for a future domain
// change) without touching code -- but there is exactly one correct value
// for this deployment today, so a hardcoded default is fine.
const DASHBOARD_PUBLIC_URL = process.env.DASHBOARD_PUBLIC_URL ?? "https://dashboard.sodboysltd.org";
// Set only by restart_dashboard_tunnel's own post-restart invocation of
// this script, never by the routine cron poll -- this is what lets
// last_restarted_at actually mean "a restart just happened," distinct
// from checked_at, which every run touches regardless.
const JUST_RESTARTED = process.env.DASHBOARD_URL_JUST_RESTARTED === "1";

if (!AGENT_SERVICE_TOKEN) {
  console.error("AGENT_SERVICE_TOKEN is required (the same value already set on the backend/fieldops-tools plugin).");
  process.exit(1);
}

async function backendFetch(path, init) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${AGENT_SERVICE_TOKEN}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function isReachable(url) {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000) });
    return res.ok || (res.status >= 300 && res.status < 500); // any real response counts as "up"
  } catch {
    return false;
  }
}

async function main() {
  const reachable = await isReachable(DASHBOARD_PUBLIC_URL);
  await backendFetch("/system/dashboard-url", { method: "PATCH", body: JSON.stringify({ url: DASHBOARD_PUBLIC_URL }) });
  await backendFetch("/system/dashboard-url/health", {
    method: "POST",
    body: JSON.stringify({ reachable, restarted: JUST_RESTARTED }),
  });
  console.log(`Dashboard URL: ${DASHBOARD_PUBLIC_URL} (reachable: ${reachable}${JUST_RESTARTED ? ", just restarted" : ""})`);
}

main().catch((err) => {
  console.error("Dashboard URL sync failed:", err);
  process.exit(1);
});
