#!/usr/bin/env node
// Runs nightly via openclaw cron (see docs/DEPLOYMENT.md). The token/cost
// data this aggregates already exists per-turn in every session's .jsonl
// transcript under ~/.openclaw/agents/*/sessions/ -- it was just never
// aggregated anywhere. Host-side because the backend container has no
// filesystem access to those files, same "backend can't reach the host"
// reasoning as every other script in this directory.
//
// Stateless by design: recomputes the full aggregate for the lookback
// window from scratch on every run and UPSERTs it, rather than tracking an
// incremental "already processed" offset -- simpler, self-healing if a run
// is missed or a file is edited/replayed, and cheap enough at this scale
// (a small-business agent's session volume) that re-scanning a rolling
// window isn't a real cost.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000/api/v1";
const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN;
const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? `${process.env.HOME}/.openclaw`;
const LOOKBACK_DAYS = Number(process.env.MODEL_USAGE_LOOKBACK_DAYS ?? 90);
// Matches the IANA timezone the cron jobs in this stack are already
// declared against (see openclaw cron list's "@ America/Toronto" entries)
// -- a turn just before/after local midnight needs to land on the day the
// business actually experienced it, not UTC's, same class of bug
// 0032_database_timezone.sql fixed for wrong_site/delay checks.
const BUSINESS_TZ = process.env.MODEL_USAGE_TZ ?? "America/Toronto";
// UUID.jsonl only -- excludes the same directory's .trajectory.jsonl,
// .trajectory-path.json, and sessions.json index, none of which carry
// per-turn usage in this shape.
const SESSION_FILE_RE = /^[0-9a-f-]{20,}\.jsonl$/i;

if (!AGENT_SERVICE_TOKEN) {
  console.error("AGENT_SERVICE_TOKEN is required (the same value already set on the backend/fieldops-tools plugin).");
  process.exit(1);
}

async function backendFetch(path, init) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${AGENT_SERVICE_TOKEN}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function localDateString(epochMs) {
  // en-CA gives YYYY-MM-DD directly, no manual formatting.
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ }).format(new Date(epochMs));
}

function listSessionFiles() {
  const agentsDir = join(OPENCLAW_HOME, "agents");
  const files = [];
  for (const agentId of readdirSync(agentsDir)) {
    const sessionsDir = join(agentsDir, agentId, "sessions");
    let entries;
    try {
      entries = readdirSync(sessionsDir);
    } catch {
      continue; // no sessions dir for this agent yet
    }
    for (const entry of entries) {
      if (SESSION_FILE_RE.test(entry)) files.push(join(sessionsDir, entry));
    }
  }
  return files;
}

function main() {
  const cutoffMs = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  // Skip files that haven't changed since the cutoff at all -- a cheap
  // mtime check before paying for a full read+parse of every session ever.
  const files = listSessionFiles().filter((f) => statSync(f).mtimeMs >= cutoffMs);

  // Keyed by "date|provider|model" -- matches model_usage_daily's own
  // primary key, so the aggregation and the UPSERT target line up exactly.
  const totals = new Map();

  for (const file of files) {
    let lines;
    try {
      lines = readFileSync(file, "utf8").split("\n");
    } catch (err) {
      console.error(`Skipping unreadable file ${file}:`, err);
      continue;
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // a truncated final line mid-write is normal, not an error
      }

      const msg = entry?.message;
      if (entry?.type !== "message" || msg?.role !== "assistant" || !msg.usage) continue;

      const epochMs = msg.timestamp ?? entry.timestamp;
      if (!epochMs || epochMs < cutoffMs) continue;

      const date = localDateString(epochMs);
      const provider = msg.provider ?? "unknown";
      const model = msg.model ?? "unknown";
      const key = `${date}|${provider}|${model}`;
      const usage = msg.usage;

      const existing = totals.get(key) ?? {
        date,
        provider,
        model,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
      };
      existing.input_tokens += usage.input ?? 0;
      existing.output_tokens += usage.output ?? 0;
      existing.cache_read_tokens += usage.cacheRead ?? 0;
      existing.cache_write_tokens += usage.cacheWrite ?? 0;
      existing.reasoning_tokens += usage.reasoningTokens ?? 0;
      existing.total_tokens += usage.totalTokens ?? 0;
      existing.cost_usd += usage.cost?.total ?? 0;
      totals.set(key, existing);
    }
  }

  return [...totals.values()];
}

const rows = main();
if (rows.length === 0) {
  console.log("No usage data found in the lookback window -- nothing to report.");
} else {
  const { rowsUpserted } = await backendFetch("/system/model-usage", {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
  const totalCost = rows.reduce((sum, r) => sum + r.cost_usd, 0);
  console.log(`Model usage synced: ${rowsUpserted} rows, $${totalCost.toFixed(4)} total across the lookback window.`);
}
