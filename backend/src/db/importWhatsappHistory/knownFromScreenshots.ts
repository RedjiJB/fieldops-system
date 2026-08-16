// Loader for knownContacts.local.json -- data transcribed by hand from
// WhatsApp group-info screenshots the user sent (not parsed from
// _chat.txt). Two things the .txt export turns out NOT to contain,
// confirmed by grepping the full parsed message set:
//   1. Phone numbers for saved contacts (the export always shows the saved
//      display name, never the underlying number).
//   2. Voluntary "X left" events -- only "X added Y" / "X removed Y" /
//      "Y was added" / "Y was removed" system messages appear in the text
//      export. Leave events only exist in the in-app "Member changes" list,
//      which is screenshot-only here.
//
// The actual data lives in knownContacts.local.json, which is gitignored
// (see .gitignore) -- it contains real crew members' phone numbers, and
// this repo is public. Never move this data back into a .ts file or
// otherwise let it get committed. knownContacts.local.example.json shows
// the expected shape with placeholder values.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), "knownContacts.local.json");

export interface KnownContact {
  /** Matches ParsedMessage.senderName for cross-referencing, where applicable. */
  chatName: string | null;
  /**
   * Set when chatName is a pseudonym/nickname rather than the person's real
   * name (e.g. a WhatsApp display name chosen as a joke) -- when present,
   * this is what should be used as crew_members.name on import, not
   * chatName. chatName is never replaced outright since it's what actually
   * appears in the parsed chat text and is required for message matching.
   */
  realName?: string;
  phone: string | null;
  /** True if the digits shown were cut off in the screenshot (not a full number). */
  phonePartial: boolean;
  source: "screenshot_member_list" | "screenshot_contact_card";
  note?: string;
}

export interface ScreenshotMembershipEvent {
  /** Resolved chat name where known; null for raw-phone-number-only entries. */
  chatName: string | null;
  /** Digits as shown in the screenshot, for entries that appeared as a bare number. */
  rawPhone: string | null;
  eventType: "left" | "removed";
  /** ISO date (day precision unless a time was visible). */
  timestamp: string;
  /** True where the screenshot showed a relative day name ("Thu") instead of a date -- resolved against the conversation's "today" and flagged as inferred. */
  dateInferred: boolean;
}

interface LocalData {
  knownContacts: KnownContact[];
  /** The group's "current members" list as shown in the Members tab screenshot -- treated as ground truth for "who's currently in the group" since reconstructing that from the (confirmed-incomplete) event log would be less reliable than this direct snapshot. */
  currentMemberNames: string[];
  screenshotMembershipEvents: ScreenshotMembershipEvent[];
}

function loadLocalData(): LocalData {
  if (!existsSync(DATA_PATH)) {
    throw new Error(
      `Missing ${DATA_PATH}. This file holds real crew phone numbers transcribed from WhatsApp screenshots and is deliberately gitignored -- it's never committed to this public repo. Copy knownContacts.local.example.json to knownContacts.local.json and fill in real values from the group's screenshots.`,
    );
  }
  return JSON.parse(readFileSync(DATA_PATH, "utf8"));
}

const data = loadLocalData();
export const KNOWN_CONTACTS: KnownContact[] = data.knownContacts;
export const CURRENT_MEMBER_NAMES: string[] = data.currentMemberNames;
export const SCREENSHOT_MEMBERSHIP_EVENTS: ScreenshotMembershipEvent[] = data.screenshotMembershipEvents;
