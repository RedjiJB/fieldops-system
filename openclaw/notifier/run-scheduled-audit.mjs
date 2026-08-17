#!/usr/bin/env node
// Runs every 12 hours via openclaw cron, host-side -- same reasoning as
// backup-database.mjs's docker dependency, plus this also needs `npm`/`npx`
// and the openclaw CLI itself (for plugin build/validate and agent-tests),
// none of which any container in this stack has.
//
// Built 2026-08-17 after a live incident (a ~50-minute connectivity blip
// that self-recovered, but left 4 alerts sitting open and 2 approved
// morning-digest drafts stuck undelivered with nothing watching for either)
// made clear that heartbeat.mjs's 2-minute infra checks and the one-off
// manual test/doc pass earlier that day don't add up to a standing "is
// everything actually still working" check. This is that check: the same
// build/test/validate steps a human would run by hand before trusting a
// deploy, run on a schedule, with the full output saved (not just a
// pass/fail line) so a "wait, when did this start failing" question has an
// actual answer to look back at.
//
// Deliberately does NOT treat every agent-tests scenario failure as
// alert-worthy -- SECURITY.md already documents that this suite has a real,
// bounded LLM-reliability noise floor (DeepSeek not 100% reliably following
// confirm-before-execute, observed ~6/7 on affected scenarios even after the
// prompt fix). Paging IT every 12 hours for that exact known noise would be
// the alert-fatigue failure this whole notifications system was built to
// avoid. Only a build/typecheck/vitest/validate failure (deterministic --
// these have no reason to ever fail in a healthy repo) or a sharp drop in
// agent-tests pass rate (something structurally broken, not noise) reports
// to IT; a normal run's full results are still saved either way.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000/api/v1";
const HEALTH_URL = process.env.HEALTH_URL ?? "http://localhost:3000/health";
const DASHBOARD_PUBLIC_URL = process.env.DASHBOARD_PUBLIC_URL ?? "https://dashboard.sodboysltd.org";
const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN;
const REPO_DIR = process.env.FIELDOPS_REPO_DIR ?? `${process.env.HOME}/fieldops-system`;
// Deliberately outside REPO_DIR, same reasoning as backup-database.mjs's
// BACKUPS_DIR -- a log dump has no business inside a git-tracked working
// directory, even by accident.
const LOGS_DIR = process.env.FIELDOPS_AUDIT_LOGS_DIR ?? `${process.env.HOME}/fieldops-audit-logs`;
const RETENTION_DAYS = 30;
// agent-tests' own runAgent.ts shells out to the bare `openclaw` binary by
// name (no env override there), which fails with ENOENT under a cron job's
// `sh -lc` shell if it doesn't source the same PATH an interactive SSH
// session does -- the exact gotcha every other script in this directory
// documents. Since that file can't be pointed at an absolute path directly,
// this script prepends OPENCLAW_BIN's directory to the agent-tests child
// process's own PATH instead, when set.
const OPENCLAW_BIN = process.env.OPENCLAW_BIN;
// Below this, treat agent-tests as structurally broken rather than normal
// per-scenario noise -- see the header comment for where this number comes
// from (observed floor is 12-14/14 on a healthy system).
const AGENT_TESTS_MIN_HEALTHY_RATIO = 0.5;

if (!AGENT_SERVICE_TOKEN) {
  console.error("AGENT_SERVICE_TOKEN is required (the same value already set on the backend/fieldops-tools plugin).");
  process.exit(1);
}

async function backendFetch(path, init) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${AGENT_SERVICE_TOKEN}`, "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// Every check runs to completion regardless of earlier failures, so one
// broken step never hides the state of the rest -- same reasoning as
// heartbeat.mjs's deliberately-not-short-circuited backend/Postgres checks.
function runStep(label, cwd, cmd, args, extraEnv) {
  const start = Date.now();
  try {
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const output = execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: "pipe", maxBuffer: 20 * 1024 * 1024, env });
    return { label, ok: true, durationMs: Date.now() - start, output };
  } catch (err) {
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n") || String(err);
    return { label, ok: false, durationMs: Date.now() - start, output };
  }
}

function pruneOldLogs() {
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of readdirSync(LOGS_DIR)) {
    if (!file.endsWith(".log")) continue;
    const filePath = join(LOGS_DIR, file);
    if (statSync(filePath).mtimeMs < cutoffMs) unlinkSync(filePath);
  }
}

// Parses agent-tests' own "N/M passed." summary line rather than re-deriving
// pass/fail from raw PASS/FAIL lines -- one source of truth, the same one a
// human reading the output would use.
function parseAgentTestsSummary(output) {
  const match = output.match(/(\d+)\/(\d+) passed\./);
  if (!match) return null;
  return { passed: Number(match[1]), total: Number(match[2]) };
}

async function checkAudit() {
  const lines = [];
  let healthy = true;

  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) });
    lines.push(`Backend /health: ${res.ok ? "ok" : `HTTP ${res.status}`}`);
    if (!res.ok) healthy = false;
  } catch (err) {
    lines.push(`Backend /health: unreachable (${err instanceof Error ? err.message : err})`);
    healthy = false;
  }

  try {
    const res = await fetch(DASHBOARD_PUBLIC_URL, { signal: AbortSignal.timeout(8000) });
    lines.push(`Dashboard (${DASHBOARD_PUBLIC_URL}): ${res.ok ? "reachable" : `HTTP ${res.status}`}`);
    if (!res.ok) healthy = false;
  } catch (err) {
    lines.push(`Dashboard (${DASHBOARD_PUBLIC_URL}): unreachable (${err instanceof Error ? err.message : err})`);
    healthy = false;
  }

  try {
    const ps = execFileSync("docker", ["compose", "ps", "--format", "{{.Name}}: {{.Status}}"], {
      cwd: REPO_DIR,
      encoding: "utf8",
    });
    lines.push("Containers:", ps.trim());
  } catch (err) {
    lines.push(`docker compose ps failed: ${err instanceof Error ? err.message : err}`);
    healthy = false;
  }

  // Informational only -- an old open alert or a pending draft isn't this
  // script's failure to report (that's what the Alerts/Confirmations pages
  // and the normal notification pipeline are for), just useful context
  // sitting next to the test results when someone reads the log.
  try {
    const [alerts, drafts, confirmations] = await Promise.all([
      backendFetch("/alerts?resolved=false"),
      backendFetch("/system/message-drafts?status=pending"),
      backendFetch("/pending-confirmations?status=awaiting_management"),
    ]);
    lines.push(
      `Open: ${alerts.length} unresolved alert(s), ${drafts.length} pending message draft(s), ${confirmations.length} pending_confirmation(s) awaiting management.`,
    );
  } catch (err) {
    lines.push(`Could not fetch open-item counts: ${err instanceof Error ? err.message : err}`);
  }

  return { healthy, report: lines.join("\n") };
}

async function main() {
  mkdirSync(LOGS_DIR, { recursive: true });

  const steps = [];
  steps.push(runStep("backend typecheck", join(REPO_DIR, "backend"), "npx", ["tsc", "--noEmit"]));
  steps.push(runStep("fieldops-tools build", join(REPO_DIR, "openclaw/plugins/fieldops-tools"), "npm", ["run", "build"]));
  steps.push(
    runStep("fieldops-tools vitest", join(REPO_DIR, "openclaw/plugins/fieldops-tools"), "npx", [
      "vitest",
      "run",
      "--config",
      "./vitest.config.ts",
    ]),
  );
  steps.push(
    runStep("fieldops-tools plugin validate", join(REPO_DIR, "openclaw/plugins/fieldops-tools"), "npx", [
      "openclaw",
      "plugins",
      "validate",
      "--entry",
      "./dist/index.js",
    ]),
  );
  steps.push(runStep("fieldops-media build", join(REPO_DIR, "openclaw/plugins/fieldops-media"), "npm", ["run", "build"]));
  steps.push(
    runStep("fieldops-media vitest", join(REPO_DIR, "openclaw/plugins/fieldops-media"), "npx", [
      "vitest",
      "run",
      "--config",
      "./vitest.config.ts",
    ]),
  );

  const agentTestsEnv = OPENCLAW_BIN ? { PATH: `${dirname(OPENCLAW_BIN)}:${process.env.PATH}` } : undefined;
  const agentTests = runStep(
    "agent-tests (live, no --deliver)",
    join(REPO_DIR, "openclaw/agent-tests"),
    "npm",
    ["test"],
    agentTestsEnv,
  );
  const agentTestsSummary = parseAgentTestsSummary(agentTests.output);

  const audit = await checkAudit();

  const deterministicFailures = steps.filter((s) => !s.ok);
  const agentTestsUnhealthy =
    agentTestsSummary !== null && agentTestsSummary.passed / agentTestsSummary.total < AGENT_TESTS_MIN_HEALTHY_RATIO;
  const agentTestsCouldNotRun = !agentTests.ok && agentTestsSummary === null;
  const overallHealthy = deterministicFailures.length === 0 && audit.healthy && !agentTestsUnhealthy && !agentTestsCouldNotRun;

  const timestamp = new Date().toISOString();
  const reportParts = [
    `FieldOps scheduled audit -- ${timestamp}`,
    "=".repeat(60),
    "",
    "## Deterministic checks",
    ...steps.map((s) => `\n### ${s.label} — ${s.ok ? "PASS" : "FAIL"} (${s.durationMs}ms)\n${s.output.trim()}`),
    "",
    "## Agent-tests (live LLM, no --deliver -- see openclaw/agent-tests/src/runAgent.ts)",
    `${agentTests.ok || agentTestsSummary ? "ran" : "FAILED TO RUN"} (${agentTests.durationMs}ms)${
      agentTestsSummary ? ` — ${agentTestsSummary.passed}/${agentTestsSummary.total} passed` : ""
    }`,
    agentTests.output.trim(),
    "",
    "## System audit",
    audit.report,
    "",
    "=".repeat(60),
    `Overall: ${overallHealthy ? "HEALTHY" : "NEEDS ATTENTION"}`,
  ];
  const report = reportParts.join("\n");

  const fileStamp = timestamp.replace(/[:.]/g, "-");
  const logPath = join(LOGS_DIR, `audit-${fileStamp}.log`);
  writeFileSync(logPath, report);
  pruneOldLogs();

  console.log(`Audit complete: ${overallHealthy ? "HEALTHY" : "NEEDS ATTENTION"} -- full report saved to ${logPath}`);

  if (!overallHealthy) {
    const problems = [
      ...deterministicFailures.map((s) => s.label),
      agentTestsCouldNotRun ? "agent-tests suite failed to run" : null,
      agentTestsUnhealthy ? `agent-tests only ${agentTestsSummary.passed}/${agentTestsSummary.total} passed` : null,
      !audit.healthy ? "system audit found an unreachable check (see log)" : null,
    ].filter(Boolean);

    try {
      await backendFetch("/system/it-issue", {
        method: "POST",
        body: JSON.stringify({
          message: `Scheduled 12-hour audit found problems: ${problems.join("; ")}. Full report: ${logPath} (on the Pi).`,
        }),
      });
    } catch (err) {
      console.error("Additionally failed to report the failure via /system/it-issue:", err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Scheduled audit run itself failed:", err);
  process.exit(1);
});
