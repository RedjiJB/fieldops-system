// Tier 3: shift/timeclock/checkout inference. Lowest confidence of the
// three tiers, explicitly opted into. Two very different quality levels
// live under "Tier 3" here, and the report keeps them visibly separate:
//
// - Dispatch-derived shifts (3a): Nick's own dispatch messages turn out to
//   be much more structured than casual chat -- "@Jesse @Korbin 800hh
//   start, 18 sunridge lane, sod job" is a real (if informal) shift
//   assignment: crew + site + start time + date, all in one message. These
//   become the actual candidate `shifts`/`timeclock_entries` rows.
// - Presence cues (3b): freeform arrival/departure language ("Im here",
//   "we just left the site") with no resolvable site or time attached.
//   Never synthesized into their own DB rows -- attached as a confidence
//   note to a 3a shift for the same person/day if one exists, otherwise
//   just surfaced as a loose observation in the report.
//
// Checkouts get the lightest treatment of all: tool-custody language
// ("I left my box cutter...") is flagged as a text-only candidate for
// manual follow-up, never auto-built into a structured checkouts row --
// assigning asset_id/timestamps confidently from casual custody language
// isn't something this pass attempts.
import type { ParsedMessage } from "./parseChat.js";
import { normalizeSenderName } from "./parseChat.js";
import type { SiteCandidate } from "./siteExtractor.js";

const MENTION_RE = /@⁨([^⁩]*)⁩/g;
const TIME_RE = /\b(\d{3,4})\s?(?:hh|start)\b/i;
const ADDRESS_RE =
  /\b\d{1,5}\s+[A-Za-z][A-Za-z\s]{1,25}?\s+(crescent|cres\.?|street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|way|blvd\.?|boulevard|circle|cir\.?|place|pl\.?)\b/i;

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

function parseTimeToken(digits: string): string {
  const padded = digits.length === 3 ? "0" + digits : digits;
  const hour = padded.slice(0, 2);
  const minute = padded.slice(2, 4);
  return `${hour}:${minute}`;
}

function resolveMentions(text: string, allCrewNames: string[], messageDate: Date, allMessages: ParsedMessage[]): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    const raw = m[1].replace(/‎/g, "").replace(/^~\s*/, "").trim();
    if (raw.toLowerCase() === "all") {
      // Approximate "everyone" as anyone who sent a message within 14 days
      // of this dispatch -- there's no clean day-by-day roster timeline to
      // resolve this precisely (see rosterBuilder.ts's join/leave gaps).
      // Flagged as approximate wherever this path is used.
      const windowMs = 14 * 24 * 60 * 60 * 1000;
      for (const name of allCrewNames) {
        const active = allMessages.some(
          (msg) => msg.senderName === name && Math.abs(msg.timestamp.getTime() - messageDate.getTime()) <= windowMs,
        );
        if (active) names.add(name);
      }
    } else {
      const normalized = normalizeSenderName(raw);
      if (allCrewNames.includes(normalized)) names.add(normalized);
    }
  }
  return [...names];
}

export interface DispatchShiftCandidate {
  date: string; // YYYY-MM-DD
  crewName: string;
  siteKey: string | null;
  siteDisplayText: string | null;
  startTime: string | null; // HH:MM
  mentionMode: "explicit" | "all-approx";
  sourceMessage: string;
  presenceNotes: string[]; // Tier 3b cues from the same person on the same day, if any
}

export function extractDispatchShiftCandidates(
  messages: ParsedMessage[],
  allCrewNames: string[],
  siteCandidates: SiteCandidate[],
): DispatchShiftCandidate[] {
  const siteByKey = new Map(siteCandidates.map((s) => [s.key, s]));
  const candidates: DispatchShiftCandidate[] = [];

  for (const msg of messages) {
    if (msg.isSystemMessage) continue;
    if (!MENTION_RE.test(msg.text)) continue;
    MENTION_RE.lastIndex = 0;

    const timeMatch = TIME_RE.exec(msg.text);
    const addressMatch = ADDRESS_RE.exec(msg.text);
    if (!timeMatch && !addressMatch) continue; // mention alone isn't dispatch-like enough

    const mentionedAll = /@⁨‎?all⁩/i.test(msg.text);
    const crewNames = resolveMentions(msg.text, allCrewNames, msg.timestamp, messages);
    if (crewNames.length === 0) continue;

    const siteKey = addressMatch ? normalizeKey(addressMatch[0]) : null;
    const site = siteKey ? siteByKey.get(siteKey) : undefined;
    const date = msg.timestamp.toISOString().slice(0, 10);

    for (const crewName of crewNames) {
      candidates.push({
        date,
        crewName,
        siteKey: site?.key ?? null,
        siteDisplayText: site?.displayText ?? null,
        startTime: timeMatch ? parseTimeToken(timeMatch[1]) : null,
        mentionMode: mentionedAll ? "all-approx" : "explicit",
        sourceMessage: msg.text.replace(/\n/g, " "),
        presenceNotes: [],
      });
    }
  }

  // Attach same-person-same-day presence cues (Tier 3b) as supplementary notes.
  const cues = extractPresenceCues(messages);
  for (const c of candidates) {
    c.presenceNotes = cues
      .filter((cue) => cue.crewName === c.crewName && cue.date === c.date)
      .map((cue) => `${cue.type}: "${cue.sourceMessage}"`);
  }

  return candidates;
}

export interface PresenceCue {
  crewName: string;
  date: string;
  type: "arrival" | "departure";
  sourceMessage: string;
}

const ARRIVAL_CUES = ["im here", "i'm here", "here now", "just got here", "just arrived", "arrived"];
const DEPARTURE_CUES = ["just left", "we left", "we just left", "heading out", "heading home", "wrapped up", "done for the day", "packing up"];

export function extractPresenceCues(messages: ParsedMessage[]): PresenceCue[] {
  const cues: PresenceCue[] = [];
  for (const msg of messages) {
    if (msg.isSystemMessage) continue;
    if (msg.senderName === "The Sod Boys") continue;
    const lower = msg.text.toLowerCase();
    const date = msg.timestamp.toISOString().slice(0, 10);
    if (ARRIVAL_CUES.some((c) => lower.includes(c))) {
      cues.push({ crewName: msg.senderName, date, type: "arrival", sourceMessage: msg.text.replace(/\n/g, " ") });
    } else if (DEPARTURE_CUES.some((c) => lower.includes(c))) {
      cues.push({ crewName: msg.senderName, date, type: "departure", sourceMessage: msg.text.replace(/\n/g, " ") });
    }
  }
  return cues;
}

export interface CheckoutCandidate {
  crewName: string;
  date: string;
  toolKeyword: string;
  sourceMessage: string;
}

// Small, fixed keyword list -- deliberately not exhaustive. This is a
// text-only flag for manual follow-up, not an attempt to resolve a real
// asset_id, so a short list that catches the obvious cases is enough.
const TOOL_KEYWORDS = [
  "box cutter", "roller", "trimmer", "blower", "mower", "chainsaw", "shovel",
  "wheelbarrow", "compactor", "sod cutter", "pallet jack", "roller cap",
];
const CUSTODY_PHRASES = ["left my", "left the", "grab my", "picked up the", "have the", "borrowed", "is at my house", "on to it", "on to me"];

export function extractCheckoutCandidates(messages: ParsedMessage[]): CheckoutCandidate[] {
  const candidates: CheckoutCandidate[] = [];
  for (const msg of messages) {
    if (msg.isSystemMessage || msg.senderName === "The Sod Boys") continue;
    const lower = msg.text.toLowerCase();
    const tool = TOOL_KEYWORDS.find((t) => lower.includes(t));
    const hasCustodyLanguage = CUSTODY_PHRASES.some((p) => lower.includes(p));
    if (tool && hasCustodyLanguage) {
      candidates.push({
        crewName: msg.senderName,
        date: msg.timestamp.toISOString().slice(0, 10),
        toolKeyword: tool,
        sourceMessage: msg.text.replace(/\n/g, " "),
      });
    }
  }
  return candidates;
}
