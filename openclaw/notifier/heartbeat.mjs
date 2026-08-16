#!/usr/bin/env node
// Runs every 2 minutes on the Pi host (tighter than sync-dashboard-url.mjs's
// 5-minute interval -- this is the last line of defense, see below), same
// reasoning as every other notifier script: needs real `docker`/network
// access no container has.
//
// Built after a real ~20-minute dashboard outage on 2026-08-16 that was
// NOT caught by anything -- diagnosed afterward (dmesg/journalctl showed no
// WiFi deauth/reassoc events, no thermal throttling) as upstream/ISP-level
// packet loss the Pi's own WiFi link never even noticed. Nothing before
// this watched for that failure mode, or for the backend/Postgres/frontend
// containers themselves going down, or for the disk filling up.
//
// The one thing every other alert in this codebase assumes and this script
// can't: if the backend or Postgres is down, nothing can POST an alert TO
// the backend to report that. So this script is the one place that
// messages WhatsApp DIRECTLY (bypassing the backend/notifications table
// entirely) for exactly that case -- everything else it finds (connectivity,
// disk) goes through the normal POST-to-backend-then-raiseAlert pipeline,
// same shape as sync-dashboard-url.mjs/backup-database.mjs, since the
// backend being reachable is a precondition for those checks even mattering.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000/api/v1";
// Deliberately separate from BACKEND_URL -- /health is mounted at the bare
// root, not under /api/v1 (same route every other health check in this repo
// hits). Confirmed live 2026-08-16: using BACKEND_URL for this hit
// /api/v1/health instead, which 401s ("Authentication required", a real API
// route, just the wrong one) rather than 200s, so checkBackend() always
// reported the backend down even when it was healthy.
const HEALTH_URL = process.env.HEALTH_URL ?? "http://localhost:3000/health";
const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN;
const REPO_DIR = process.env.FIELDOPS_REPO_DIR ?? `${process.env.HOME}/fieldops-system`;
const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";
// Local state file, deliberately NOT in the Postgres-backed backend --
// the whole point of this script is to keep working when the backend
// can't be reached, so its own memory (recipient cache, active-outage
// tracking) has to live somewhere that doesn't depend on it either.
const STATE_PATH = process.env.FIELDOPS_HEARTBEAT_STATE ?? `${process.env.HOME}/.fieldops-heartbeat-state.json`;

// 1 GB free -- picked the same way BACKUP_STALE_HOURS/VEHICLE_DARK_HOURS
// were in exceptions.ts: wide enough that normal log/image churn never
// false-positives, tight enough to catch a genuinely filling disk with
// enough runway left to actually do something about it.
const DISK_LOW_THRESHOLD_GB = 1;

if (!AGENT_SERVICE_TOKEN) {
  console.error("AGENT_SERVICE_TOKEN is required (the same value already set on the backend/fieldops-tools plugin).");
  process.exit(1);
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { outageStartedAt: null, cachedRecipients: [] };
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { outageStartedAt: null, cachedRecipients: [] };
  }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function backendFetch(path, init, timeoutMs = 5000) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${AGENT_SERVICE_TOKEN}`, "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function checkBackend() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

function checkPostgres() {
  try {
    execFileSync("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "fieldops"], {
      cwd: REPO_DIR,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

async function checkFrontend() {
  try {
    const res = await fetch("http://localhost:8080/", { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

function checkDisk() {
  try {
    // -k: sizes in 1024-byte blocks, so column 4 (available) / 1024 = MB, /1024 again = GB.
    const output = execFileSync("df", ["-k", "/"], { encoding: "utf8" });
    const line = output.trim().split("\n")[1];
    const availableKb = Number(line.trim().split(/\s+/)[3]);
    const availableGb = availableKb / 1024 / 1024;
    return { low: availableGb < DISK_LOW_THRESHOLD_GB, availableGb };
  } catch {
    return { low: false, availableGb: null }; // fail open -- a df parse failure isn't evidence of low disk
  }
}

// TCP connect rather than ICMP ping -- no dependency on a `ping` binary
// being present/permitted, and a successful TCP handshake is a more direct
// proxy for "can this host actually reach the internet" than ICMP, which
// some networks filter differently than everything else anyway. Two
// well-known anchors, reachable if either succeeds -- avoids a false
// positive from one specific IP being slow/blocked rather than the Pi's
// uplink actually being down (this is exactly the failure signature
// confirmed live on 2026-08-16: multi-second latency to every external IP
// tried, not just one).
function tcpReachable(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function checkConnectivity() {
  const [a, b] = await Promise.all([tcpReachable("1.1.1.1", 443, 4000), tcpReachable("8.8.8.8", 443, 4000)]);
  return a || b;
}

function sendWhatsApp(target, message) {
  execFileSync(OPENCLAW_BIN, ["message", "send", "--channel", "whatsapp", "--target", target, "--message", message, "--json"], {
    stdio: "pipe",
  });
}

async function refreshRecipientCache(state) {
  try {
    const settings = await backendFetch("/notification-settings");
    const roles = settings.it_escalation_roles;
    const phones = new Set();
    for (const role of roles) {
      const members = await backendFetch(`/crew-members?role=${role}&active=true`);
      for (const m of members) if (m.phone) phones.add(m.phone);
    }
    if (phones.size > 0) {
      state.cachedRecipients = [...phones];
      saveState(state);
    }
  } catch {
    // Backend unreachable or otherwise failed -- keep whatever was cached
    // from the last successful run. Only reachable when things are
    // healthy, which is exactly when this doesn't matter yet.
  }
}

async function main() {
  const state = loadState();
  // Independent checks, deliberately not short-circuited -- checkPostgres()
  // goes straight through `docker exec`, nothing to do with the backend's
  // HTTP API, so backend-down is not evidence either way about Postgres.
  // Confirmed live 2026-08-16: an earlier version skipped this check
  // whenever backendUp was false, which (combined with the checkBackend()
  // URL bug above) meant a single wrong health-check path was on track to
  // page the owner with a false "Postgres is unreachable" every 2 minutes.
  const [backendUp, postgresUp] = await Promise.all([checkBackend(), checkPostgres()]);

  if (!backendUp || !postgresUp) {
    const now = new Date().toISOString();
    if (!state.outageStartedAt) {
      state.outageStartedAt = now;
      saveState(state);
      const recipients = state.cachedRecipients;
      if (recipients.length === 0) {
        console.error("Backend/Postgres down and no cached recipient phone numbers available -- cannot alert anyone.");
      } else {
        const reason = !backendUp ? "backend is unreachable" : "Postgres is unreachable";
        for (const target of recipients) {
          try {
            sendWhatsApp(target, `🚨 FieldOps system alert: the ${reason}. This message was sent directly, bypassing the normal notification pipeline, since that pipeline depends on the thing that's down.`);
          } catch (err) {
            console.error(`Failed to send outage alert to ${target}:`, err instanceof Error ? err.message : err);
          }
        }
      }
    }
    console.log(`Backend/Postgres check failed (backendUp=${backendUp}, postgresUp=${postgresUp}). Outage started ${state.outageStartedAt}.`);
    return; // nothing else to check meaningfully while the backend's down
  }

  // Recovered from a tracked outage -- backfill the historical record and
  // clear local state so the next real outage starts fresh.
  if (state.outageStartedAt) {
    const outageEndedAt = new Date().toISOString();
    try {
      await backendFetch("/system/offline-recovery", {
        method: "POST",
        body: JSON.stringify({ outageStartedAt: state.outageStartedAt, outageEndedAt }),
      });
      console.log(`Recovered from outage that started ${state.outageStartedAt}, ended ${outageEndedAt}.`);
    } catch (err) {
      console.error("Failed to backfill offline-recovery record:", err instanceof Error ? err.message : err);
    }
    state.outageStartedAt = null;
    saveState(state);
  }

  await refreshRecipientCache(state);

  const [frontendUp, disk, connectivityUp] = await Promise.all([checkFrontend(), Promise.resolve(checkDisk()), checkConnectivity()]);

  await backendFetch("/system/connectivity-health", {
    method: "POST",
    body: JSON.stringify({ reachable: connectivityUp }),
  });
  await backendFetch("/system/disk-health", {
    method: "POST",
    body: JSON.stringify({ low: disk.low, availableGb: disk.availableGb }),
  });

  if (!frontendUp) {
    // No dedicated alert type for this -- the frontend being down but the
    // backend/Postgres up is an unusual combination (they're built from
    // the same docker compose file and normally rise/fall together); log
    // it for now rather than adding a fifth alert type for a case that
    // hasn't actually been observed.
    console.error("Frontend container did not respond, but backend/Postgres are up -- unusual, logged only.");
  }

  console.log(
    `Heartbeat OK: backend=${backendUp} postgres=${postgresUp} frontend=${frontendUp} connectivity=${connectivityUp} disk=${disk.availableGb?.toFixed(1)}GB free.`,
  );
}

main().catch((err) => {
  console.error("Heartbeat run failed:", err);
  process.exit(1);
});
