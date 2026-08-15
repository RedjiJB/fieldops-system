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
// always take the last match, never the first. Excludes api.trycloudflare.com,
// which is cloudflared's own control-plane host and matches the same pattern
// but is never a tunnel URL.
function extractLatestUrl(logOutput) {
  const matches = logOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)?.filter((u) => u !== "https://api.trycloudflare.com");
  return matches?.length ? matches[matches.length - 1] : null;
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
  // Bounded tail (--tail=100), not unbounded -- inverted from this script's
  // original design, and confirmed empirically live rather than assumed.
  // A plain `docker compose logs cloudflared` with no --tail limit was
  // found to silently omit the most recently-written URL banner once the
  // service's log rotation (max-size 10m, max-file 3) has cycled -- root
  // cause not fully chased down (a multi-rotated-file read/ordering quirk
  // in this Engine/Compose version), but reproduced directly: --tail=500
  // returned a banner from *hours* earlier while --tail=50 through
  // --tail=200, queried at the same moment, all correctly returned the
  // live URL. 100 sits in the middle of that empirically-confirmed-good
  // range, comfortably above one restart cycle's ~15-20 lines of precheck/
  // connection noise (with margin for a couple of rapid reconnects) and
  // comfortably below where spillover into older rotated files was
  // observed. (Also tried `--since <container StartedAt>` to scope to just
  // the current run -- abandoned separately: `--since` returned zero lines
  // even for timestamps seconds in the past, on this host, for reasons not
  // chased down.)
  const logOutput = execFileSync("docker", ["compose", "logs", "cloudflared", "--tail=100"], {
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
