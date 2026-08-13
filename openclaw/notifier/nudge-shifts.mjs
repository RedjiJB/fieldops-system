#!/usr/bin/env node
// Runs once daily (evening before), on the Pi host, same reasoning as
// deliver-notifications.mjs: the backend can't reach openclaw directly.
// Separate script/cron job rather than folded into the notifier -- this
// targets a different phone per row (the crew member, not a fixed
// management number), reads from /shifts not /notifications, and tracks
// its own "already handled" column (shifts.nudged_at).
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

async function main() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const shifts = await backendFetch(`/shifts?date=${tomorrow}&status=assigned`);

  for (const shift of shifts) {
    if (shift.nudged_at) continue;
    if (!shift.crew_member_phone) {
      console.error(`Shift ${shift.id}: crew member has no phone on file, skipping`);
      continue;
    }
    try {
      const message =
        `You're scheduled tomorrow (${tomorrow}) at ${shift.site_name ?? "your site"}` +
        `${shift.start_time ? ` @ ${shift.start_time}` : ""}. Reply CONFIRM or DECLINE.`;
      execFileSync(
        OPENCLAW_BIN,
        ["message", "send", "--channel", "whatsapp", "--target", shift.crew_member_phone, "--message", message],
        { stdio: "pipe" },
      );
      await backendFetch(`/shifts/${shift.id}/nudged`, { method: "PATCH" });
      console.log(`Nudged shift ${shift.id} (${shift.crew_member_name})`);
    } catch (err) {
      // Leave nudged_at unset for retry on the next run.
      console.error(`Failed to nudge shift ${shift.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("Nudge run failed:", err);
  process.exit(1);
});
