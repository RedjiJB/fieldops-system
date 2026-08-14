#!/usr/bin/env node
// Runs frequently (same ~1min cadence as deliver-notifications.mjs), on the
// Pi host -- the backend can't reach openclaw directly. Separate script
// rather than folded into the notifier: this targets a different phone per
// row (the crew member who submitted the pending confirmation, not a fixed
// management number), reads from /pending-confirmations not /notifications,
// and tracks its own "already handled" column (crew_notified_at).
import { execFileSync } from "node:child_process";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000/api/v1";
const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN;
const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";

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

function messageFor(pc) {
  if (pc.status === "approved") return `✅ Approved: ${pc.summary}`;
  if (pc.status === "rejected") return `❌ Not approved: ${pc.summary}`;
  return `⏱️ No response in time, expired: ${pc.summary}`;
}

async function main() {
  const pending = await backendFetch("/pending-confirmations/unnotified");

  for (const pc of pending) {
    if (!pc.crew_member_phone) {
      console.error(`Pending confirmation ${pc.id}: crew member has no phone on file, skipping`);
      continue;
    }
    try {
      execFileSync(
        OPENCLAW_BIN,
        ["message", "send", "--channel", "whatsapp", "--target", pc.crew_member_phone, "--message", messageFor(pc)],
        { stdio: "pipe" },
      );
      await backendFetch(`/pending-confirmations/${pc.id}/mark-notified`, { method: "PATCH" });
      console.log(`Notified ${pc.crew_member_name} of ${pc.id} (${pc.status})`);
    } catch (err) {
      // Leave crew_notified_at unset for retry on the next run.
      console.error(`Failed to notify for ${pc.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("Confirmation-outcome delivery run failed:", err);
  process.exit(1);
});
