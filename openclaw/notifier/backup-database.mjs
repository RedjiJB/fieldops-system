#!/usr/bin/env node
// Runs nightly via openclaw cron (see docs/DEPLOYMENT.md's "Backups"
// section) -- host-side because pg_dump needs `docker compose exec`, and
// this stack's containers are only reachable from the host, same reasoning
// as sync-dashboard-url.mjs's own docker CLI dependency (no container here
// has a docker.sock mount).
//
// This closes a real gap, not a hypothetical one: docs/DEPLOYMENT.md
// documented a crontab-based nightly pg_dump as if it were already running,
// but it had never actually been installed on the Pi -- no crontab, no
// backup files, confirmed directly. This script plus its companion
// backup_status table (0059_backup_status.sql) is what makes that state
// visible and alertable instead of silently assumed.
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000/api/v1";
const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN;
const REPO_DIR = process.env.FIELDOPS_REPO_DIR ?? `${process.env.HOME}/fieldops-system`;
// Deliberately outside REPO_DIR -- a database dump should never be able to
// land inside a git-tracked working directory, even by accident.
const BACKUPS_DIR = process.env.FIELDOPS_BACKUPS_DIR ?? `${process.env.HOME}/fieldops-backups`;
// Local-disk retention only -- off-Pi sync (Drive, another machine) is a
// separate, deliberately manual follow-up per docs/DEPLOYMENT.md, not
// automated here.
const RETENTION_DAYS = 14;

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

function pruneOldBackups() {
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of readdirSync(BACKUPS_DIR)) {
    if (!file.endsWith(".sql.gz")) continue;
    const filePath = join(BACKUPS_DIR, file);
    if (statSync(filePath).mtimeMs < cutoffMs) unlinkSync(filePath);
  }
}

async function main() {
  mkdirSync(BACKUPS_DIR, { recursive: true });

  const dump = execFileSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "pg_dump", "-U", "fieldops", "fieldops"],
    { cwd: REPO_DIR, maxBuffer: 1024 * 1024 * 1024 }, // 1GB headroom -- a small-business dataset, not a concern
  );

  // pg_dump can exit 0 but produce an empty/truncated stream on some
  // failure modes (e.g. a mid-dump connection drop) -- a schema that always
  // has at least the migrations table never legitimately dumps empty, so
  // treat that as a failure rather than trusting exit code alone.
  if (dump.length === 0) throw new Error("pg_dump produced no output");

  const gzipped = gzipSync(dump);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const outPath = join(BACKUPS_DIR, `fieldops-${dateStamp}.sql.gz`);
  writeFileSync(outPath, gzipped);
  pruneOldBackups();

  await backendFetch("/system/backup-status", {
    method: "POST",
    body: JSON.stringify({ success: true, sizeBytes: gzipped.length }),
  });
  console.log(`Backup complete: ${outPath} (${gzipped.length} bytes)`);
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Backup failed:", message);
  try {
    await backendFetch("/system/backup-status", {
      method: "POST",
      body: JSON.stringify({ success: false, error: message.slice(0, 500) }),
    });
  } catch (reportErr) {
    console.error("Additionally failed to report backup-status:", reportErr);
  }
  process.exit(1);
});
