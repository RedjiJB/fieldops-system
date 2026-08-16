import type { RosterEntry } from "./rosterBuilder.js";
import type { SiteCandidate } from "./siteExtractor.js";
import type { CheckoutCandidate, DispatchShiftCandidate, PresenceCue } from "./activityInference.js";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function generateReport(
  sourceFile: string,
  messageCount: number,
  dateRange: [Date, Date],
  roster: RosterEntry[],
  sites: SiteCandidate[],
  dispatchShifts: DispatchShiftCandidate[],
  presenceCues: PresenceCue[],
  checkoutCandidates: CheckoutCandidate[],
): string {
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("# WhatsApp History Import -- Dry-Run Review Report");
  push();
  push(`Generated: ${new Date().toISOString()}`);
  push(`Source: \`${sourceFile}\``);
  push(`Messages parsed: ${messageCount}`);
  push(`Date range: ${fmtDate(dateRange[0])} to ${fmtDate(dateRange[1])}`);
  push();
  push("**Nothing in this report has been written to the database.** This is Tier 1/2/3 output for review only, per the approved plan -- see `synthetic-finding-dahl.md`.");
  push();

  // ---------------------------------------------------------------
  push("## Tier 1 -- Crew Roster (high confidence)");
  push();
  push("Reconstructed from WhatsApp's own add/removed system messages (mechanical, timestamped) plus phone numbers/leave-events manually transcribed from the group-info screenshots. The screenshot's \"Member changes\" list was itself cut off at the top (\"more\" visible above the earliest row shown) -- there may be earlier history neither source captures.");
  push();
  push("| Name | Phone | Status | First seen | Last seen | Messages | Flags |");
  push("|---|---|---|---|---|---|---|");
  for (const r of roster) {
    const status = r.isVendorNotCrew ? "vendor, not crew" : r.currentlyActive ? "active" : "inactive";
    const phone = r.phone ? (r.phoneComplete ? r.phone : `${r.phone}... (incomplete)`) : "**missing**";
    push(
      `| ${escapeCell(r.name)} | ${phone} | ${status} | ${fmtDate(r.firstSeenInChat)} | ${fmtDate(r.lastSeenInChat)} | ${r.messageCount} | ${r.flags.length ? "⚠️ " + r.flags.length : ""} |`,
    );
  }
  push();
  const flaggedRoster = roster.filter((r) => r.flags.length > 0);
  if (flaggedRoster.length > 0) {
    push("### Roster flags (need your input before import)");
    push();
    for (const r of flaggedRoster) {
      push(`**${r.name}**`);
      for (const f of r.flags) push(`- ${f}`);
      push();
    }
  }

  // ---------------------------------------------------------------
  push("## Tier 2 -- Site Candidates (medium confidence)");
  push();
  push(`${sites.length} candidate addresses extracted from dispatch messages. Never auto-inserted -- confirm/edit before these become \`sites\` rows. Some noise expected (a few matches are ordinary sentences containing a street-suffix word, e.g. "drive" as a verb) -- obvious ones are easy to skip.`);
  push();
  push("| Address (as typed) | Occurrences | First seen | Last seen | Sample context |");
  push("|---|---|---|---|---|");
  for (const s of sites) {
    push(`| ${escapeCell(s.displayText)} | ${s.occurrences} | ${fmtDate(s.firstSeen)} | ${fmtDate(s.lastSeen)} | ${escapeCell(s.sampleContext[0].slice(0, 80))} |`);
  }
  push();

  // ---------------------------------------------------------------
  push("## Tier 3a -- Dispatch-Derived Shift Candidates (lower confidence, structured)");
  push();
  push(
    `${dispatchShifts.length} candidate shift assignments, parsed from Nick's dispatch messages (crew @mentions + address + start time in one message). ${dispatchShifts.filter((s) => s.siteKey).length} have a resolved site, ${dispatchShifts.filter((s) => s.startTime).length} have a resolved start time, ${dispatchShifts.filter((s) => s.mentionMode === "all-approx").length} came from an "@all" mention resolved by a 14-day activity-window approximation rather than an explicit name -- flagged individually below as \`all-approx\`.`,
  );
  push();
  push("**None of these were geofence-verified or system-captured** -- if imported, every resulting `shifts`/`timeclock_entries` row must carry `import_source = 'whatsapp_history_import'` (migration 0066) and `geofence_verified = false`, never anything suggesting real-time verification.");
  push();

  const byPerson = new Map<string, DispatchShiftCandidate[]>();
  for (const s of dispatchShifts) {
    if (!byPerson.has(s.crewName)) byPerson.set(s.crewName, []);
    byPerson.get(s.crewName)!.push(s);
  }
  for (const [name, candidates] of [...byPerson.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    push(`### ${name} (${candidates.length} candidate shifts)`);
    push();
    push("| Date | Site | Start | Mode | Presence notes | Source |");
    push("|---|---|---|---|---|---|");
    for (const c of candidates.sort((a, b) => a.date.localeCompare(b.date))) {
      push(
        `| ${c.date} | ${c.siteDisplayText ? escapeCell(c.siteDisplayText) : "—"} | ${c.startTime ?? "—"} | ${c.mentionMode} | ${c.presenceNotes.length ? escapeCell(c.presenceNotes.join("; ")) : "—"} | ${escapeCell(c.sourceMessage.slice(0, 70))} |`,
      );
    }
    push();
  }

  // ---------------------------------------------------------------
  push("## Tier 3b -- Presence Cues (supplementary only, not imported as rows)");
  push();
  push(`${presenceCues.length} freeform arrival/departure messages found ("Im here", "we just left", etc.). Already folded into the Tier 3a tables above where they match a person/day with a dispatch candidate. Listed here in full for completeness -- these do NOT become their own database rows under any circumstance (no resolvable site or time).`);
  push();
  push("| Date | Crew member | Type | Message |");
  push("|---|---|---|---|");
  for (const c of presenceCues) {
    push(`| ${c.date} | ${escapeCell(c.crewName)} | ${c.type} | ${escapeCell(c.sourceMessage)} |`);
  }
  push();

  // ---------------------------------------------------------------
  push("## Checkout Candidates (text-only flags, lowest confidence)");
  push();
  push(`${checkoutCandidates.length} messages mention a recognized tool alongside custody language ("I left my...", "...is at my house"). These are flagged for manual follow-up only -- none are proposed as structured \`checkouts\` rows; assigning a specific \`asset_id\` and timestamps from casual chat text isn't attempted here.`);
  push();
  push("| Date | Crew member | Tool | Message |");
  push("|---|---|---|---|");
  for (const c of checkoutCandidates) {
    push(`| ${c.date} | ${escapeCell(c.crewName)} | ${c.toolKeyword} | ${escapeCell(c.sourceMessage)} |`);
  }
  push();

  // ---------------------------------------------------------------
  push("## Summary of action items before import can run");
  push();
  const missingPhones = roster.filter((r) => !r.isVendorNotCrew && !r.phone && !r.name.startsWith("(unresolved"));
  const partialPhones = roster.filter((r) => r.phone && !r.phoneComplete);
  const unresolved = roster.filter((r) => r.name.startsWith("(unresolved"));
  push(`1. **Missing phone numbers** (${missingPhones.length}): ${missingPhones.map((r) => r.name).join(", ") || "none"} -- required, \`crew_members.phone\` is UNIQUE NOT NULL.`);
  push(`2. **Incomplete phone numbers** (${partialPhones.length}): ${partialPhones.map((r) => `${r.name} (${r.phone}...)`).join(", ") || "none"}.`);
  push(`3. **Unresolved identities** (${unresolved.length}): raw phone numbers with no name available -- ${unresolved.map((r) => r.phone).join(", ") || "none"}.`);
  push("4. **Site candidates**: review the Tier 2 table, confirm/edit before they become `sites` rows.");
  push("5. **Dispatch shift candidates**: spot-check the Tier 3a tables, especially `all-approx` rows.");
  push("6. **The Fence And Deck Company**: confirm whether to import as a `vendors` row or drop entirely.");
  push();

  return lines.join("\n");
}
