// Tier 1: crew roster reconstruction. High confidence -- WhatsApp's own
// system messages ("X added Y", "X removed Y") are mechanically parsed with
// real timestamps, not inferred from conversational text. Combined with the
// screenshot-transcribed data (see knownFromScreenshots.ts) for phone
// numbers and voluntary-leave events, which the chat text export doesn't
// contain at all (confirmed: no "X left" system message appears anywhere in
// the parsed text, only in the in-app Member changes list).
import { normalizeSenderName, type ParsedMessage } from "./parseChat.js";
import { CURRENT_MEMBER_NAMES, KNOWN_CONTACTS, SCREENSHOT_MEMBERSHIP_EVENTS } from "./knownFromScreenshots.js";

// Order matters: "X was added"/"X was removed" must be tried before the
// generic "added"/"removed" patterns, though in practice the generic
// patterns can't match those strings anyway (they require content *after*
// "added "/"removed ", which "was added"/"was removed" endings don't have).
const ADDED_RE = /^(.+?) added (you|.+)$/;
const REMOVED_RE = /^(.+?) removed (.+)$/;
const WAS_ADDED_RE = /^(.+?) was added$/;
const WAS_REMOVED_RE = /^(.+?) was removed$/;
const CREATED_RE = /^(.+?) created this group$/;

export type ChatMembershipEvent =
  | { type: "added"; actor: string; target: string; timestamp: Date }
  | { type: "removed"; actor: string; target: string; timestamp: Date }
  | { type: "was_added"; target: string; timestamp: Date }
  | { type: "was_removed"; target: string; timestamp: Date };

export function extractChatMembershipEvents(messages: ParsedMessage[]): ChatMembershipEvent[] {
  const events: ChatMembershipEvent[] = [];
  for (const msg of messages) {
    // Restricting to LRM-flagged messages is load-bearing, not defensive:
    // without it, ordinary sentences containing "added"/"removed" (e.g.
    // "soil needs to be added around it") false-match the patterns below.
    if (!msg.isSystemMessage) continue;
    const text = msg.text.trim();
    if (CREATED_RE.test(text)) continue;

    let m = ADDED_RE.exec(text);
    if (m) {
      const target = m[2] === "you" ? "you" : normalizeSenderName(m[2]);
      if (target === "you") continue; // the exporter (Redji JB) being added -- already a real crew member
      events.push({ type: "added", actor: normalizeSenderName(m[1]), target, timestamp: msg.timestamp });
      continue;
    }
    m = REMOVED_RE.exec(text);
    if (m) {
      events.push({ type: "removed", actor: normalizeSenderName(m[1]), target: normalizeSenderName(m[2]), timestamp: msg.timestamp });
      continue;
    }
    m = WAS_ADDED_RE.exec(text);
    if (m) {
      events.push({ type: "was_added", target: normalizeSenderName(m[1]), timestamp: msg.timestamp });
      continue;
    }
    m = WAS_REMOVED_RE.exec(text);
    if (m) {
      events.push({ type: "was_removed", target: normalizeSenderName(m[1]), timestamp: msg.timestamp });
    }
  }
  return events;
}

export interface RosterEntry {
  name: string;
  phone: string | null;
  phoneComplete: boolean;
  currentlyActive: boolean;
  firstSeenInChat: Date | null;
  lastSeenInChat: Date | null;
  messageCount: number;
  isVendorNotCrew: boolean;
  chatMembershipEvents: ChatMembershipEvent[];
  screenshotEvents: { eventType: "left" | "removed"; timestamp: Date }[];
  flags: string[];
}

export function buildRoster(messages: ParsedMessage[]): RosterEntry[] {
  const chatEvents = extractChatMembershipEvents(messages);

  // Every name that ever appears as a message sender, or as an actor/target
  // in a membership event (chat-derived or screenshot-derived).
  const names = new Set<string>();
  for (const msg of messages) {
    if (msg.senderName !== "The Sod Boys") names.add(msg.senderName);
  }
  for (const ev of chatEvents) {
    if (ev.type === "added" || ev.type === "removed") names.add(ev.actor);
    names.add(ev.target);
  }
  for (const ev of SCREENSHOT_MEMBERSHIP_EVENTS) {
    if (ev.chatName) names.add(ev.chatName);
  }
  names.delete("");
  names.delete("Redji JB"); // the exporter -- already a real crew_members row, not part of this import

  const roster: RosterEntry[] = [];
  for (const name of names) {
    const messagesFromName = messages.filter((m) => m.senderName === name);
    const known = KNOWN_CONTACTS.find((c) => c.chatName === name);
    const screenshotEvents = SCREENSHOT_MEMBERSHIP_EVENTS.filter((e) => e.chatName === name).map((e) => ({
      eventType: e.eventType,
      timestamp: new Date(e.timestamp),
    }));
    const entryChatEvents = chatEvents.filter((e) => e.target === name || ("actor" in e && e.actor === name));

    const flags: string[] = [];
    const isVendorNotCrew = name === "The Fence And Deck Company";
    if (isVendorNotCrew) {
      flags.push("Not a crew member -- business account added by mistake (self-identified: \"Think you added me by mistake. This is Mike Ahern\"). Recommend importing as a vendors row instead, or dropping.");
    }

    const currentlyActive = CURRENT_MEMBER_NAMES.includes(name);

    if (!isVendorNotCrew) {
      if (!known || !known.phone) {
        flags.push("No phone number available from chat text or screenshots -- crew_members.phone is UNIQUE NOT NULL, cannot import without one.");
      } else if (known.phonePartial) {
        flags.push(`Phone number incomplete in screenshot (shown as "${known.phone}...") -- needs the full number before import.`);
      }
    }

    if (screenshotEvents.length === 0 && entryChatEvents.length === 0 && !currentlyActive && !isVendorNotCrew) {
      flags.push("No membership event found in either source -- appeared only as a message sender. First/last message timestamps used as a rough activity window instead of real join/leave dates.");
    }

    roster.push({
      name,
      phone: known?.phone ?? null,
      phoneComplete: known ? !known.phonePartial : false,
      currentlyActive,
      firstSeenInChat: messagesFromName.length ? messagesFromName[0].timestamp : null,
      lastSeenInChat: messagesFromName.length ? messagesFromName[messagesFromName.length - 1].timestamp : null,
      messageCount: messagesFromName.length,
      isVendorNotCrew,
      chatMembershipEvents: entryChatEvents,
      screenshotEvents,
      flags,
    });
  }

  // Also surface the raw-phone-number-only screenshot entries that never
  // resolved to a chat name at all -- these are real people/entities in the
  // group's history that this roster otherwise has no row for.
  const unresolvedPhones = SCREENSHOT_MEMBERSHIP_EVENTS.filter((e) => !e.chatName && e.rawPhone);
  for (const ev of unresolvedPhones) {
    roster.push({
      name: `(unresolved: ${ev.rawPhone})`,
      phone: ev.rawPhone,
      phoneComplete: true,
      currentlyActive: false,
      firstSeenInChat: null,
      lastSeenInChat: null,
      messageCount: 0,
      isVendorNotCrew: false,
      chatMembershipEvents: [],
      screenshotEvents: [{ eventType: ev.eventType, timestamp: new Date(ev.timestamp) }],
      flags: [
        "Never appears as a named/saved sender in the chat text -- no way to identify who this is from the sources available. Left/removed with only a raw phone number on record. Needs manual identification before import (or import as an unnamed inactive crew_members row with this phone, if the owner can't identify them).",
      ],
    });
  }

  roster.sort((a, b) => a.name.localeCompare(b.name));
  return roster;
}
