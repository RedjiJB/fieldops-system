#!/usr/bin/env node
// Runs every 10 minutes on the Pi host, same reasoning as nudge-shifts.mjs
// (the backend can't reach openclaw directly). A distinct script rather
// than folded into nudge-shifts.mjs -- that one runs once daily, evening
// before, for confirm/decline; this needs a much tighter polling cadence
// to catch a rolling "starting in about an hour" window, and only targets
// shifts already confirmed (an unconfirmed one already got the
// evening-before ask, a reminder about a shift nobody confirmed yet would
// be presumptuous).
import { execFileSync } from "node:child_process";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000/api/v1";
const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN;
const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";
// The window's own width (60) plus this script's poll interval (10) --
// wide enough that a shift starting in, say, 55 minutes is caught on this
// tick even if the previous tick landed at the 65-minute mark and missed it.
const REMINDER_WINDOW_MINUTES = 70;

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
  const today = new Date().toISOString().slice(0, 10);
  const shifts = await backendFetch(`/shifts?date=${today}&status=confirmed`);
  const now = Date.now();

  for (const shift of shifts) {
    if (shift.reminder_sent_at || !shift.start_time) continue;
    if (!shift.crew_member_phone) {
      console.error(`Shift ${shift.id}: crew member has no phone on file, skipping`);
      continue;
    }

    const startsAt = new Date(`${today}T${shift.start_time}`).getTime();
    const minutesUntilStart = (startsAt - now) / (1000 * 60);
    // Skip anything already started or further out than the window --
    // this run isn't the one to remind them, a later tick will be.
    if (minutesUntilStart < 0 || minutesUntilStart > REMINDER_WINDOW_MINUTES) continue;

    try {
      const message = `Your shift starts in about an hour — ${shift.site_name ?? "your site"} @ ${shift.start_time}.`;
      execFileSync(
        OPENCLAW_BIN,
        ["message", "send", "--channel", "whatsapp", "--target", shift.crew_member_phone, "--message", message],
        { stdio: "pipe" },
      );
      await backendFetch(`/shifts/${shift.id}/reminder-sent`, { method: "PATCH" });
      console.log(`Reminded shift ${shift.id} (${shift.crew_member_name})`);
    } catch (err) {
      // Leave reminder_sent_at unset for retry on the next run.
      console.error(`Failed to remind shift ${shift.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("Shift reminder run failed:", err);
  process.exit(1);
});
