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
  const logOutput = execFileSync("docker", ["compose", "logs", "--tail", "50", "cloudflared"], {
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
    body: JSON.stringify({ reachable }),
  });
  console.log(`Dashboard URL: ${url} (reachable: ${reachable})`);
}

main().catch((err) => {
  console.error("Dashboard URL sync failed:", err);
  process.exit(1);
});
