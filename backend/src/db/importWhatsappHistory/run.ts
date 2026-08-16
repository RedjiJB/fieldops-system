// Dry-run entrypoint: parses the WhatsApp export, runs all three
// extraction tiers, writes a markdown review report. Makes NO database
// writes -- read-only against the filesystem only. See
// synthetic-finding-dahl.md for the approved plan this implements, and
// each tier's own module for its confidence rationale.
//
// Usage: npx tsx src/db/importWhatsappHistory/run.ts <path-to-_chat.txt> <output-report.md>
import { writeFileSync } from "node:fs";
import { parseChat } from "./parseChat.js";
import { buildRoster } from "./rosterBuilder.js";
import { extractSiteCandidates } from "./siteExtractor.js";
import { extractCheckoutCandidates, extractDispatchShiftCandidates, extractPresenceCues } from "./activityInference.js";
import { generateReport } from "./report.js";

const [, , chatPath, outPath] = process.argv;
if (!chatPath || !outPath) {
  console.error("Usage: npx tsx src/db/importWhatsappHistory/run.ts <path-to-_chat.txt> <output-report.md>");
  process.exit(1);
}

const messages = parseChat(chatPath);
if (messages.length === 0) {
  console.error(`No messages parsed from ${chatPath} -- check the file path/format.`);
  process.exit(1);
}

const roster = buildRoster(messages);
const crewNames = roster.filter((r) => !r.isVendorNotCrew && !r.name.startsWith("(unresolved")).map((r) => r.name);
const sites = extractSiteCandidates(messages);
const dispatchShifts = extractDispatchShiftCandidates(messages, crewNames, sites);
const presenceCues = extractPresenceCues(messages);
const checkoutCandidates = extractCheckoutCandidates(messages);

const dateRange: [Date, Date] = [messages[0].timestamp, messages[messages.length - 1].timestamp];
const report = generateReport(chatPath, messages.length, dateRange, roster, sites, dispatchShifts, presenceCues, checkoutCandidates);

writeFileSync(outPath, report, "utf8");
console.log(`Wrote review report to ${outPath}`);
console.log(`Roster: ${roster.length} entries (${roster.filter((r) => r.currentlyActive).length} currently active)`);
console.log(`Sites: ${sites.length} candidates`);
console.log(`Dispatch shifts: ${dispatchShifts.length} candidates`);
console.log(`Presence cues: ${presenceCues.length}`);
console.log(`Checkout candidates: ${checkoutCandidates.length}`);
