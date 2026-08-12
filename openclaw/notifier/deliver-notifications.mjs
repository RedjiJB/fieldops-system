#!/usr/bin/env node
// Runs on the Pi host (via `openclaw cron --command`), NOT in a container —
// this is deliberate: the backend runs in Docker with no filesystem or
// network path to the openclaw binary/gateway, so delivery has to be
// initiated from the OpenClaw side, polling the backend's HTTP API (the
// one direction that already works) rather than the other way around.
// Dependency-free on purpose — global fetch + node:child_process only, no
// npm install step required for a cron job to run reliably.
import { execFileSync } from "node:child_process";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000/api/v1";
const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN;
const MANAGEMENT_WHATSAPP_NUMBER = process.env.MANAGEMENT_WHATSAPP_NUMBER;
// A cron --command job's sh -lc doesn't necessarily source the same PATH as
// an interactive SSH session (npm-global bin is often added by .bashrc,
// which login shells don't source) -- default to plain "openclaw" for
// interactive/dev use, but let the cron job pin an absolute path explicitly
// rather than silently failing with ENOENT.
const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";

if (!AGENT_SERVICE_TOKEN) {
  console.error("AGENT_SERVICE_TOKEN is required (the same value already set on the backend/fieldops-tools plugin).");
  process.exit(1);
}
if (!MANAGEMENT_WHATSAPP_NUMBER) {
  console.error("MANAGEMENT_WHATSAPP_NUMBER is required (E.164, e.g. +15555550123).");
  process.exit(1);
}

async function backendFetch(path, init) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${AGENT_SERVICE_TOKEN}`, ...init?.headers },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const pending = await backendFetch("/notifications/pending");
  if (pending.length === 0) return;

  for (const notification of pending) {
    try {
      execFileSync(
        OPENCLAW_BIN,
        ["message", "send", "--channel", "whatsapp", "--target", MANAGEMENT_WHATSAPP_NUMBER, "--message", notification.message],
        { stdio: "pipe" },
      );
      await backendFetch(`/notifications/${notification.id}/delivered`, { method: "PATCH" });
      console.log(`Delivered notification ${notification.id}: ${notification.message}`);
    } catch (err) {
      // Leave undelivered for retry on the next poll -- one failed send
      // (e.g. WhatsApp momentarily down) shouldn't block the rest of the
      // batch or need any extra retry bookkeeping.
      console.error(`Failed to deliver notification ${notification.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("Notifier run failed:", err);
  process.exit(1);
});
