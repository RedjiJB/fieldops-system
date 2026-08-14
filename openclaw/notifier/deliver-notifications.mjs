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
// A cron --command job's sh -lc doesn't necessarily source the same PATH as
// an interactive SSH session (npm-global bin is often added by .bashrc,
// which login shells don't source) -- default to plain "openclaw" for
// interactive/dev use, but let the cron job pin an absolute path explicitly
// rather than silently failing with ENOENT.
const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";
// Who gets paged for a critical notification -- queried fresh every run
// rather than a fixed number, so registering a second management/owner
// crew member picks them up automatically. foreman deliberately excluded
// for now: nothing site-scopes an alert to "their" site today, so paging
// every foreman for every critical alert everywhere would be noisy: add
// "foreman" here once that changes, or if you want it unconditionally.
const CRITICAL_NOTIFICATION_ROLES = ["management", "owner"];

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

// Queried fresh every run rather than cached across the process lifetime --
// this script exits after each cron tick anyway, so there's no meaningful
// caching to do.
async function getRecipients() {
  const phones = new Set();
  for (const role of CRITICAL_NOTIFICATION_ROLES) {
    const members = await backendFetch(`/crew-members?role=${role}&active=true`);
    for (const m of members) if (m.phone) phones.add(m.phone);
  }
  if (phones.size === 0) {
    console.error(`No active crew member found with role in [${CRITICAL_NOTIFICATION_ROLES.join(", ")}] -- nowhere to deliver critical notifications.`);
  }
  return [...phones];
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
  const recipients = await getRecipients();
  if (recipients.length === 0) return; // already logged in getRecipients()

  const pending = await backendFetch("/notifications/pending");
  for (const notification of pending) {
    // One notifications row still means one delivered_at/whatsapp_message_id
    // -- the acknowledgment schema was never designed for per-recipient
    // tracking, and still isn't here. First successful send's id is what
    // gets recorded; whoever acknowledges first (on any recipient's phone)
    // clears it for the whole team, same "management as a unit" semantics
    // this had when there was only ever one recipient. A real per-recipient
    // notification_deliveries table would be a bigger, separate change.
    let firstMessageId = null;
    let anySucceeded = false;
    for (const target of recipients) {
      try {
        const whatsappMessageId = sendWhatsApp(target, notification.message);
        if (!anySucceeded) firstMessageId = whatsappMessageId;
        anySucceeded = true;
      } catch (err) {
        console.error(`Failed to deliver notification ${notification.id} to ${target}:`, err instanceof Error ? err.message : err);
      }
    }
    if (!anySucceeded) continue; // leave undelivered for retry, same as before

    try {
      await backendFetch(`/notifications/${notification.id}/delivered`, {
        method: "PATCH",
        body: JSON.stringify({ whatsapp_message_id: firstMessageId }),
      });
      console.log(`Delivered notification ${notification.id} to ${recipients.length} recipient(s): ${notification.message}`);
    } catch (err) {
      console.error(`Sent but failed to mark notification ${notification.id} delivered:`, err instanceof Error ? err.message : err);
    }
  }

  const escalations = await backendFetch("/notifications/escalation-candidates");
  for (const notification of escalations) {
    let anySucceeded = false;
    for (const target of recipients) {
      try {
        sendWhatsApp(target, `⏰ Still needs attention: ${notification.message}`);
        anySucceeded = true;
      } catch (err) {
        console.error(`Failed to escalate notification ${notification.id} to ${target}:`, err instanceof Error ? err.message : err);
      }
    }
    if (!anySucceeded) continue;

    try {
      await backendFetch(`/notifications/${notification.id}/escalate`, { method: "PATCH" });
      console.log(`Escalated notification ${notification.id} to ${recipients.length} recipient(s) (count now ${notification.escalated_count + 1})`);
    } catch (err) {
      console.error(`Sent but failed to mark notification ${notification.id} escalated:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("Notifier run failed:", err);
  process.exit(1);
});
