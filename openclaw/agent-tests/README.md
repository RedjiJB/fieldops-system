# FieldOps Agent Tool-Calling Tests

Fourteen scenarios that send real messages to the real `fieldops` agent (via `openclaw agent --json`, no `--deliver`, so nothing reaches a real chat) and check it calls the right tool(s) — testing the AI/tool-selection layer specifically, not just the backend HTTP surface.

**This costs real model tokens and calls a real LLM on every run.** Not free, not perfectly deterministic in wording — assertions check *which tool got called* and real Postgres side effects, never exact reply text.

Runs on the Pi (like `openclaw` itself), not from a laptop — the CLI talks to the local gateway.

## Run

```bash
npm install
npm test
```

## What's covered

- Read-only lookups, identity resolution by phone, and refusing to guess an unknown sender's identity
- Confirm-before-execute for a single mutation (`register_vehicle`) and a batch one (`assign_shifts_batch`), asserting the tool is *not* called before confirmation and *is* called after
- A business-rule rejection (checking out an unconfirmed asset) actually holds at the database level regardless of what the agent says
- Vehicle-location resolution, both when a crew member has an assigned vehicle and when they don't
- Two hard guardrails: no tool calls at all for an HR/pay dispute, and no non-office-routing tool for a "contact the vendor directly" request
- Multi-tool reasoning for an open-ended status request
- A same-conversation typo correction actually gets honored, not the original wrong value
- Replying to something the system sent first, not a fresh request: a short affirmative acknowledges the one open critical notification (and never resolves the underlying alert as a side effect), and an affirmative shift-confirmation message actually moves the shift to `confirmed` in the database (the real "reply CONFIRM or DECLINE" nudge context itself can't be simulated by this harness — see the scenario's own comment for why)

See `openclaw/agent-workspace/AGENTS.md` for the rules being tested — each scenario traces back to a specific line in it.

## Fixtures

Each scenario creates whatever crew member/site/vehicle/asset it needs directly in Postgres immediately before running, and deletes it in a `finally` block regardless of pass/fail. Nothing should linger between runs — if a run is interrupted mid-scenario, check for rows with `TEST-`/`Test `-prefixed names or `+15559990*` phone numbers and clean up manually.

## Explicitly out of scope

Exhaustive per-tool coverage (65 tools × phrasings) — this is 14 representative scenarios across tool groups and hard rules, not a full matrix. Not wired into CI or scheduled — real token cost per run means it stays a manually-invoked script. Only tests DeepSeek (the only provider with a real key right now), not the rest of the fallback chain.

**Escalation and `vehicle_dark` deliberately have no coverage here, and can't within this framework as it exists.** Both are pure backend-worker logic (`deliver-notifications.mjs`'s re-send pass, `exceptions.ts`'s `checkVehicleDark`) that runs on a timer and never involves the agent calling a tool in response to a message — there's no tool-selection decision for this harness to assert on. Real regression coverage for those would need a different kind of test (seed Postgres state, trigger/wait for the exceptions worker's periodic tick, assert on the resulting `alerts`/`notifications` rows directly) that doesn't exist anywhere in this codebase yet — a backend-level integration-test harness, not an extension of this one. Out of scope for this pass; both were verified manually and live instead (see `docs/EXCEPTION_HANDLING.md` and this session's deploy verification for `maintenance_due`/`backup_failed`, built the same way).
