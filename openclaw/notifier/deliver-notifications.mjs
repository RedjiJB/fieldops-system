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
    headers: { Authorization: `Bearer ${AGENT_SERVICE_TOKEN}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// The exact JSON field name for a sent message's id is unconfirmed as of
// this script -- the WhatsApp channel plugin's source isn't installed
// locally to check. Try known candidates and degrade to null silently if
// none match; a null whatsapp_message_id just means the id-based
// acknowledgment path falls back to the heuristic one (see AGENTS.md).
function sendWhatsApp(target, message) {
  const output = execFileSync(
    OPENCLAW_BIN,
    ["message", "send", "--channel", "whatsapp", "--target", target, "--message", message, "--json"],
    { stdio: "pipe" },
  ).toString();
  try {
    const parsed = JSON.parse(output);
    return parsed.messageId ?? parsed.id ?? parsed.payload?.result?.messageId ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const pending = await backendFetch("/notifications/pending");
  for (const notification of pending) {
    try {
      const whatsappMessageId = sendWhatsApp(MANAGEMENT_WHATSAPP_NUMBER, notification.message);
      await backendFetch(`/notifications/${notification.id}/delivered`, {
        method: "PATCH",
        body: JSON.stringify({ whatsapp_message_id: whatsappMessageId }),
      });
      console.log(`Delivered notification ${notification.id}: ${notification.message}`);
    } catch (err) {
      // Leave undelivered for retry on the next poll -- one failed send
      // (e.g. WhatsApp momentarily down) shouldn't block the rest of the
      // batch or need any extra retry bookkeeping.
      console.error(`Failed to deliver notification ${notification.id}:`, err instanceof Error ? err.message : err);
    }
  }

  const escalations = await backendFetch("/notifications/escalation-candidates");
  for (const notification of escalations) {
    try {
      sendWhatsApp(MANAGEMENT_WHATSAPP_NUMBER, `⏰ Still needs attention: ${notification.message}`);
      await backendFetch(`/notifications/${notification.id}/escalate`, { method: "PATCH" });
      console.log(`Escalated notification ${notification.id} (count now ${notification.escalated_count + 1})`);
    } catch (err) {
      console.error(`Failed to escalate notification ${notification.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("Notifier run failed:", err);
  process.exit(1);
});
