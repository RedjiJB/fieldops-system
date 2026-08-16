// Applies Tier 1 (roster) only -- the high-confidence tier, built from
// WhatsApp's own system messages with real timestamps, not inferred from
// conversational text. Tier 2 (sites) and Tier 3 (shifts/checkouts) are
// deliberately NOT written here -- see siteExtractor.ts's and
// activityInference.ts's own header comments for why those need per-item
// owner review rather than a bulk write.
//
// Idempotent-ish by phone: uses ON CONFLICT (phone) DO NOTHING, so running
// this twice against the same chat export won't duplicate rows -- but it's
// meant to run once, against a freshly wiped crew_members table.
//
// Usage: npx tsx src/db/importWhatsappHistory/applyRoster.ts <path-to-_chat.txt>
import { parseChat } from "./parseChat.js";
import { buildRoster } from "./rosterBuilder.js";
import { pool } from "../pool.js";

const [, , chatPath] = process.argv;
if (!chatPath) {
  console.error("Usage: npx tsx src/db/importWhatsappHistory/applyRoster.ts <path-to-_chat.txt>");
  process.exit(1);
}

const messages = parseChat(chatPath);
if (messages.length === 0) {
  console.error(`No messages parsed from ${chatPath} -- check the file path/format.`);
  process.exit(1);
}

const roster = buildRoster(messages);

let inserted = 0;
let skipped = 0;

for (const entry of roster) {
  if (entry.isVendorNotCrew) {
    console.log(`SKIP (vendor, not crew): ${entry.name}`);
    skipped++;
    continue;
  }
  if (!entry.phone || !entry.phoneComplete) {
    console.log(`SKIP (no complete phone): ${entry.name}`);
    skipped++;
    continue;
  }

  const name = entry.realName ?? entry.name;
  const active = entry.currentlyActive;

  // Earliest known removal/leave timestamp, from either source -- used as
  // deactivated_at for anyone not currently active. Screenshot events and
  // chat-derived membership events are independent sources that can both
  // exist for the same person; take whichever is earliest.
  let deactivatedAt: Date | null = null;
  if (!active) {
    const candidates: Date[] = [
      ...entry.screenshotEvents.map((e) => e.timestamp),
      ...entry.chatMembershipEvents.filter((e) => e.type === "removed" || e.type === "was_removed").map((e) => e.timestamp),
    ];
    if (candidates.length > 0) {
      deactivatedAt = new Date(Math.min(...candidates.map((d) => d.getTime())));
    }
  }

  const result = await pool.query(
    `INSERT INTO crew_members (name, phone, role, active, deactivated_at)
     VALUES ($1, $2, 'crew', $3, $4)
     ON CONFLICT (phone) DO NOTHING
     RETURNING id`,
    [name, entry.phone, active, deactivatedAt],
  );

  if (result.rows.length > 0) {
    console.log(`INSERT: ${name} (${entry.phone}) -- role: crew, active: ${active}${deactivatedAt ? `, deactivated: ${deactivatedAt.toISOString()}` : ""}`);
    inserted++;
  } else {
    console.log(`SKIP (phone already exists): ${name} (${entry.phone})`);
    skipped++;
  }
}

console.log(`\nDone. Inserted ${inserted}, skipped ${skipped}.`);
console.log(`All imported at role "crew" -- promote foreman/management/owner as needed via the Crew page.`);
await pool.end();
