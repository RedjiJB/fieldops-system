#!/usr/bin/env node
// Runs nightly, reads every real WhatsApp session transcript (~/.openclaw/agents/fieldops/sessions/*.jsonl,
// the plain per-turn log, not the .trajectory.jsonl/.trajectory-path.json sibling files that track internal
// replay state) and compiles a human-readable Markdown digest of the last 24h of conversations -- who said
// what, what the agent replied, and which tools it called -- so Redji can actually read what the bot did
// each day instead of only hearing about it when something goes wrong. Built directly off tonight's
// NO_REPLY/verbosity bugs, which were only found by reading raw session files by hand over SSH.
//
// Deliberately host-side and file-based, not a dashboard page: this is IT's own development tool, and these
// transcripts can contain the same personnel/pay/HR-adjacent content AGENTS.md tells the agent never to act
// on -- putting that behind a web page, even an admin-gated one, is a bigger exposure than a file only
// reachable by SSH/SCP to the Pi, matching how backup-database.mjs already treats its dumps.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SESSIONS_DIR = process.env.FIELDOPS_SESSIONS_DIR ?? `${process.env.HOME}/.openclaw/agents/fieldops/sessions`;
const OUTPUT_DIR = process.env.FIELDOPS_TRANSCRIPTS_DIR ?? `${process.env.HOME}/fieldops-transcripts`;
const NOTIFY_TARGET = process.env.TRANSCRIPT_NOTIFY_TARGET ?? "+18193196405";
const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";
const LOOKBACK_HOURS = Number(process.env.TRANSCRIPT_LOOKBACK_HOURS ?? 24);

function localDateStamp(d) {
  // America/Toronto, matching every other cron job's date convention in this stack.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function localTimeStamp(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}

function readSessionMessages(path) {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const messages = [];
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "message") continue;
    messages.push({ ts: Date.parse(entry.timestamp), message: entry.message });
  }
  return messages;
}

function renderMessage(m) {
  const role = m.message.role;
  const time = localTimeStamp(m.ts);
  if (role === "user") {
    const meta = m.message.__openclaw ?? {};
    const who = meta.senderName ? `${meta.senderName} (${meta.senderId ?? "?"})` : (meta.senderId ?? "unknown sender");
    const text = typeof m.message.content === "string" ? m.message.content : JSON.stringify(m.message.content);
    return `**${time} — ${who}:** ${text}`;
  }
  if (role === "assistant") {
    const parts = Array.isArray(m.message.content) ? m.message.content : [];
    const textParts = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
    const toolNames = parts.filter((p) => p.type === "toolCall").map((p) => p.name);
    const toolNote = toolNames.length ? `\n  _(called: ${toolNames.join(", ")})_` : "";
    if (/^NO_REPLY$/iu.test(textParts.trim())) {
      return `**${time} — bot:** _(chose not to reply)_${toolNote}`;
    }
    return `**${time} — bot:** ${textParts || "(no text)"}${toolNote}`;
  }
  return null; // toolResult and everything else: too noisy for a human-review digest, skipped on purpose.
}

function main() {
  if (!existsSync(SESSIONS_DIR)) {
    console.error(`No sessions directory at ${SESSIONS_DIR} -- nothing to export.`);
    return;
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const cutoffMs = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
  const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".jsonl") && !f.includes(".trajectory"));

  const threads = [];
  let totalMessages = 0;
  let noReplyCount = 0;

  for (const file of files) {
    const messages = readSessionMessages(`${SESSIONS_DIR}/${file}`).filter((m) => m.ts >= cutoffMs);
    if (messages.length === 0) continue;

    const rendered = messages.map(renderMessage).filter(Boolean);
    if (rendered.length === 0) continue;

    // Thread label: first user message's sender identity, if any -- falls back to the session file's own id.
    const firstUser = messages.find((m) => m.message.role === "user");
    const meta = firstUser?.message.__openclaw ?? {};
    const label = meta.senderName ? `${meta.senderName} (${meta.senderId ?? "?"})` : file.replace(".jsonl", "");

    totalMessages += rendered.length;
    noReplyCount += rendered.filter((r) => r.includes("chose not to reply")).length;
    threads.push({ label, firstTs: messages[0].ts, rendered });
  }

  threads.sort((a, b) => a.firstTs - b.firstTs);

  const dateStamp = localDateStamp(new Date());
  const outPath = `${OUTPUT_DIR}/${dateStamp}.md`;
  const header = `# Conversation transcript — ${dateStamp}\n\n${threads.length} thread(s), ${totalMessages} message(s), ${noReplyCount} silent turn(s).\n`;
  const body = threads
    .map((t) => `## ${t.label}\n\n${t.rendered.join("\n\n")}\n`)
    .join("\n---\n\n");
  writeFileSync(outPath, `${header}\n${body}\n`, "utf8");

  console.log(`Wrote ${outPath}: ${threads.length} threads, ${totalMessages} messages, ${noReplyCount} silent turns.`);

  if (NOTIFY_TARGET) {
    const summary = `Transcript ready: ${dateStamp} — ${threads.length} threads, ${totalMessages} msgs, ${noReplyCount} silent turns. See ${outPath} on the Pi.`;
    try {
      execFileSync(OPENCLAW_BIN, ["message", "send", "--channel", "whatsapp", "--target", NOTIFY_TARGET, "--message", summary, "--json"], { stdio: "pipe" });
    } catch (err) {
      console.error("Notify failed (transcript still written):", err.message);
    }
  }
}

main();
