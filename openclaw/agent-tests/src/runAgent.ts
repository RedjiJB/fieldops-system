// Shells out to the real `openclaw agent` CLI for one live turn against the
// real DeepSeek-backed gateway. No --deliver flag anywhere in this suite —
// nothing gets sent to a real chat.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

export type ToolSummary = { calls: number; tools: string[]; failures: number };

export type AgentTurnResult = {
  runId: string;
  status: string;
  replyText: string;
  toolSummary: ToolSummary;
  sessionKey: string;
};

// A fresh, unique session key per test run is not optional — confirmed live
// that `openclaw agent` without one reuses a persistent default session
// across invocations, so one scenario's conversation leaks into the next
// (observed the agent say "this is the third time you've asked" on what was
// meant to be an isolated first message).
export function freshSessionKey(scenarioId: string): string {
  return `agent:fieldops:test-${scenarioId}-${randomBytes(4).toString("hex")}`;
}

export function runAgentTurn(message: string, sessionKey: string): AgentTurnResult {
  const args = ["agent", "--agent", "fieldops", "--session-key", sessionKey, "--message", message, "--json"];
  const raw = execFileSync("openclaw", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120_000,
  });
  const parsed = JSON.parse(raw);
  const result = parsed.result ?? {};
  const payload = result.payloads?.[0];
  // Absent entirely (not an empty object) when the turn called zero tools —
  // confirmed live, not documented.
  const toolSummary: ToolSummary = result.meta?.toolSummary ?? { calls: 0, tools: [], failures: 0 };
  return {
    runId: parsed.runId,
    status: parsed.status,
    replyText: payload?.text ?? "",
    toolSummary,
    sessionKey,
  };
}

// WhatsApp injects a bracketed sender prefix into the message body the agent
// sees (per AGENTS.md: "[WhatsApp +15555550123 ...]"). `openclaw agent`'s
// --to flag only derives a session key/delivery target, not this prefix —
// confirmed live it leaves the sender phone empty in the agent's context.
// Embedding the same bracket format directly in the test message text
// reproduces what the agent actually sees from a real inbound message.
export function fromPhone(phone: string, message: string): string {
  return `[WhatsApp ${phone} ${new Date().toISOString().slice(11, 16)}] ${message}`;
}
