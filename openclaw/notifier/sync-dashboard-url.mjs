#!/usr/bin/env node
// Runs every 5 minutes on the Pi host, same reasoning as
// deliver-notifications.mjs: the backend can't reach the host directly, and
// this needs real `docker` CLI access (no container in this stack has a
// docker.sock mount) to read cloudflared's logs. The Quick Tunnel mode this
// repo currently runs (see docker-compose.yml's cloudflared service) mints
// a new random *.trycloudflare.com URL on every restart and has no uptime
// guarantee -- this script is what keeps the backend's cached URL fresh and
// what raises the dashboard_unreachable alert when it isn't.
//
// Also invoked directly (not via cron) by the agent's restart_dashboard_tunnel
// tool, right after it restarts the container -- same script either way, no
// separate logic to keep in sync.
import { execFileSync } from "node:child_process";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000/api/v1";
const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN;
const REPO_DIR = process.env.FIELDOPS_REPO_DIR ?? `${process.env.HOME}/fieldops-system`;
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

// Logs accumulate across restarts, so a URL can appear more than once --
// always take the last match, never the first.
function extractLatestUrl(logOutput) {
  const matches = logOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
  return matches ? matches[matches.length - 1] : null;
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
  // No --tail limit, deliberately: Quick Tunnel prints the URL banner once,
  // at startup, and every reconnect after that only adds churn noise (INF/ERR
  // retry lines) -- during a flapping episode that noise alone can exceed a
  // fixed tail window within minutes, permanently pushing the URL out of
  // view and forcing a false "unreachable" for as long as the churn
  // continues, even once the tunnel actually recovers (confirmed live: this
  // is what let a real dashboard_unreachable alert sit unresolved for
  // hours after the tunnel had already come back). The service's own
  // logging block (max-size 10m, max-file 3) already bounds total log
  // volume to ~30MB, so reading everything docker has buffered is cheap and
  // never actually unbounded.
  const logOutput = execFileSync("docker", ["compose", "logs", "cloudflared"], {
    cwd: REPO_DIR,
    encoding: "utf8",
  });
  const url = extractLatestUrl(logOutput);

  if (!url) {
    console.error("No trycloudflare.com URL found in recent cloudflared logs.");
    await backendFetch("/system/dashboard-url/health", {
      method: "POST",
      body: JSON.stringify({ reachable: false }),
    });
    return;
  }

  const reachable = await isReachable(url);
  await backendFetch("/system/dashboard-url", { method: "PATCH", body: JSON.stringify({ url }) });
  await backendFetch("/system/dashboard-url/health", {
    method: "POST",
    body: JSON.stringify({ reachable, restarted: JUST_RESTARTED }),
  });
  console.log(`Dashboard URL: ${url} (reachable: ${reachable}${JUST_RESTARTED ? ", just restarted" : ""})`);
}

main().catch((err) => {
  console.error("Dashboard URL sync failed:", err);
  process.exit(1);
});
