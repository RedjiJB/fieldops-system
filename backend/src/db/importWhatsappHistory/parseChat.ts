// Parses a WhatsApp "export chat without media" .txt file into a flat list
// of messages. WhatsApp's own export format, not something documented
// anywhere -- reverse-engineered from the actual export this import targets
// (_chat.txt, "The Sod Boys" group, May 2023-Aug 2026).
//
// Two quirks that break a naive regex if you don't handle them:
// - Lines are prefixed with U+200E (left-to-right mark) in front of either
//   the leading `[` or the message body itself, seemingly whenever the line
//   is system-generated (add/remove/left, "image omitted", "This message
//   was deleted") rather than user-typed. Stripped before parsing; not
//   otherwise meaningful.
// - Multi-line messages: WhatsApp does NOT escape embedded newlines. A
//   continuation line has no leading `[timestamp]` at all -- it's just the
//   next physical line, and belongs to the previous message.
import { readFileSync } from "node:fs";

const LINE_RE = /^\[(\d{4}-\d{2}-\d{2}), (\d{2}:\d{2}:\d{2})\] ([^:]+): (.*)$/;
const LRM_CHAR = "‎";
const LRM_GLOBAL = /‎/g;

export interface ParsedMessage {
  timestamp: Date;
  /** Sender exactly as it appears in the export, e.g. "~ Nick", "Josh", "The Sod Boys ". */
  senderRaw: string;
  /** senderRaw with the leading "~" marker and WhatsApp's narrow-no-break-space stripped. */
  senderName: string;
  /** Message body, possibly multi-line, LRM markers stripped. */
  text: string;
  /**
   * True when the message body was LRM-prefixed in the raw export --
   * confirmed (by inspecting every add/remove/created/media-omitted line
   * against every plain chat message) to reliably mark WhatsApp-generated
   * system messages, never user-typed text. Load-bearing: without this,
   * regular sentences that happen to contain the word "added" or "removed"
   * (e.g. "soil needs to be added around it") false-match the membership-
   * event parser in rosterBuilder.ts.
   */
  isSystemMessage: boolean;
}

export function normalizeSenderName(raw: string): string {
  return raw
    .replace(/‎/g, "")
    .replace(/^~[\s ]*/, "") // WhatsApp prefixes non-saved-as-"you" contacts with "~ "
    .replace(/[\s ]+/g, " ")
    .trim();
}

export function parseChat(filePath: string): ParsedMessage[] {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  const messages: ParsedMessage[] = [];
  for (const rawLine of lines) {
    // A leading LRM before "[" is just export noise (seen on some
    // multi-image continuation lines) -- strip it before matching, it
    // doesn't carry the system-message signal (that's checked below, on
    // the captured text group specifically).
    const lineForMatch = rawLine.startsWith(LRM_CHAR) ? rawLine.slice(1) : rawLine;
    const match = LINE_RE.exec(lineForMatch);
    if (match) {
      const [, date, time, senderRaw, text] = match;
      const isSystemMessage = text.startsWith(LRM_CHAR);
      messages.push({
        timestamp: new Date(`${date}T${time}`),
        senderRaw,
        senderName: normalizeSenderName(senderRaw),
        text: text.replace(LRM_GLOBAL, "").trim(),
        isSystemMessage,
      });
    } else if (messages.length > 0 && lineForMatch.trim() !== "") {
      // Continuation of the previous message (no timestamp prefix).
      messages[messages.length - 1].text += "\n" + lineForMatch.replace(LRM_GLOBAL, "").trim();
    }
    // Blank lines and anything before the first matched message are dropped.
  }
  return messages;
}
