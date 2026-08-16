// Applies Tier 2 (sites) and Tier 3a (dispatch-derived shifts + a paired
// timeclock "in" entry) -- owner-reviewed and confirmed accurate, per
// conversation. Explicitly does NOT touch checkout candidates: the
// checkouts table requires a real asset_id (NOT NULL, FK to assets), and
// CheckoutCandidate only ever carries a freeform tool keyword ("roller",
// "box cutter") with no asset reference -- there is no real asset row to
// point at without fabricating one, which is a different and much less
// confident kind of guess than "this address is a real site" or "this
// dispatch message is a real shift assignment". See activityInference.ts's
// own header comment, which flags this as a deliberate non-goal of the
// extractor itself, not just this apply step.
//
// Must run after applyRoster.ts (shifts.crew_member_id needs the roster
// already in crew_members).
//
// Usage: npx tsx src/db/importWhatsappHistory/applyActivity.ts <path-to-_chat.txt>
import { parseChat } from "./parseChat.js";
import { buildRoster } from "./rosterBuilder.js";
import { extractSiteCandidates } from "./siteExtractor.js";
import { extractDispatchShiftCandidates, extractCheckoutCandidates } from "./activityInference.js";
import { pool } from "../pool.js";

const IMPORT_SOURCE = "whatsapp_history_import";

const [, , chatPath] = process.argv;
if (!chatPath) {
  console.error("Usage: npx tsx src/db/importWhatsappHistory/applyActivity.ts <path-to-_chat.txt>");
  process.exit(1);
}

const messages = parseChat(chatPath);
if (messages.length === 0) {
  console.error(`No messages parsed from ${chatPath} -- check the file path/format.`);
  process.exit(1);
}

const roster = buildRoster(messages);
const crewNames = roster.filter((r) => !r.isVendorNotCrew && !r.name.startsWith("(unresolved")).map((r) => r.name);
const siteCandidates = extractSiteCandidates(messages);
const dispatchShifts = extractDispatchShiftCandidates(messages, crewNames, siteCandidates);
const checkoutCandidates = extractCheckoutCandidates(messages);

// --- Sites ---
const siteKeyToId = new Map<string, string>();
let sitesInserted = 0;
let sitesSkipped = 0;

for (const site of siteCandidates) {
  const existing = await pool.query(`SELECT id FROM sites WHERE name = $1 AND type = 'job_site'`, [site.displayText]);
  if (existing.rows.length > 0) {
    siteKeyToId.set(site.key, existing.rows[0].id);
    sitesSkipped++;
    continue;
  }
  const result = await pool.query(
    `INSERT INTO sites (name, address, type) VALUES ($1, $1, 'job_site') RETURNING id`,
    [site.displayText],
  );
  siteKeyToId.set(site.key, result.rows[0].id);
  sitesInserted++;
  console.log(`SITE INSERT: ${site.displayText} (seen ${site.occurrences}x, ${site.firstSeen.toISOString().slice(0, 10)} - ${site.lastSeen.toISOString().slice(0, 10)})`);
}

// --- Crew name -> crew_members.id lookup ---
const crewIdByName = new Map<string, string>();
const crewRows = await pool.query(`SELECT id, name, phone FROM crew_members`);
// Roster entries use the chat-derived name as the key crew names are resolved
// under (crewName on a DispatchShiftCandidate); the realName override (e.g.
// "Mike" for "Doug Ford") only affects the *imported* crew_members.name, so
// map both the chat name and any realName to the same id.
for (const entry of roster) {
  const dbRow = crewRows.rows.find((r) => r.name === (entry.realName ?? entry.name) || (entry.phone && r.phone === entry.phone));
  if (dbRow) crewIdByName.set(entry.name, dbRow.id);
}

// --- Dispatch shifts + paired timeclock "in" entry ---
let shiftsInserted = 0;
let shiftsSkippedNoSite = 0;
let shiftsSkippedNoCrew = 0;

for (const shift of dispatchShifts) {
  const crewMemberId = crewIdByName.get(shift.crewName);
  if (!crewMemberId) {
    shiftsSkippedNoCrew++;
    continue;
  }
  const siteId = shift.siteKey ? siteKeyToId.get(shift.siteKey) : undefined;
  if (!siteId) {
    shiftsSkippedNoSite++;
    continue;
  }

  const shiftResult = await pool.query(
    `INSERT INTO shifts (crew_member_id, site_id, date, start_time, status, import_source)
     VALUES ($1, $2, $3, $4, 'confirmed', $5)
     RETURNING id`,
    [crewMemberId, siteId, shift.date, shift.startTime, IMPORT_SOURCE],
  );
  shiftsInserted++;

  if (shift.startTime) {
    await pool.query(
      `INSERT INTO timeclock_entries (crew_member_id, event_type, site_id, timestamp, geofence_verified, import_source)
       VALUES ($1, 'in', $2, ($3::date + $4::time) AT TIME ZONE 'America/Toronto', false, $5)`,
      [crewMemberId, siteId, shift.date, shift.startTime, IMPORT_SOURCE],
    );
  }
  void shiftResult;
}

console.log(`\nSites: ${sitesInserted} inserted, ${sitesSkipped} already existed.`);
console.log(`Shifts: ${shiftsInserted} inserted (+ paired timeclock "in" entries where a start time was known).`);
console.log(`Shifts skipped: ${shiftsSkippedNoSite} (no resolvable site), ${shiftsSkippedNoCrew} (crew name not in imported roster -- likely Robert or the vendor, both excluded from applyRoster.ts).`);
console.log(`\nCheckout candidates (${checkoutCandidates.length}) NOT imported -- no asset_id available. See this file's header comment.`);

await pool.end();
