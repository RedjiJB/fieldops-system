// Tier 2: site candidate extraction. Medium confidence -- these are real
// addresses Nick typed in dispatch messages, but a chat-typed address isn't
// a verified one (typos, missing units, "on carp road" with no number).
// Never auto-inserted into `sites`; the dry-run report lists these as
// candidates for the owner to confirm/edit.
import type { ParsedMessage } from "./parseChat.js";

// Matches "<number> <street name> <suffix>", the dominant pattern in this
// chat (confirmed by grepping the raw export before writing this regex --
// 89 hits, e.g. "119 Desmond Ave., Kanata ON K2L 1E8", "1507 Roberval ave").
const ADDRESS_RE =
  /\b\d{1,5}\s+[A-Za-z][A-Za-z\s]{1,25}?\s+(crescent|cres\.?|street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|way|blvd\.?|boulevard|circle|cir\.?|place|pl\.?)\b/gi;

export interface SiteCandidate {
  /** Normalized (lowercased, whitespace-collapsed) for dedup -- not for display. */
  key: string;
  /** First-seen casing/text, used for display. */
  displayText: string;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  /** Up to 2 sample full messages the address was pulled from, for the owner to sanity-check the extraction. */
  sampleContext: string[];
}

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

export function extractSiteCandidates(messages: ParsedMessage[]): SiteCandidate[] {
  const byKey = new Map<string, SiteCandidate>();

  for (const msg of messages) {
    if (msg.isSystemMessage) continue;
    const matches = msg.text.matchAll(ADDRESS_RE);
    for (const m of matches) {
      const displayText = m[0].trim().replace(/[,.\s]+$/, "");
      const key = normalizeKey(displayText);
      if (key.length < 6) continue; // guards against near-empty matches

      const existing = byKey.get(key);
      if (existing) {
        existing.occurrences += 1;
        existing.lastSeen = msg.timestamp;
        if (existing.sampleContext.length < 2 && !existing.sampleContext.includes(msg.text)) {
          existing.sampleContext.push(msg.text);
        }
      } else {
        byKey.set(key, {
          key,
          displayText,
          occurrences: 1,
          firstSeen: msg.timestamp,
          lastSeen: msg.timestamp,
          sampleContext: [msg.text],
        });
      }
    }
  }

  return [...byKey.values()].sort((a, b) => b.occurrences - a.occurrences);
}
