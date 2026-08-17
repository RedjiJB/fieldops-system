# Roadmap: v2 candidates

v1 is done — see [CHANGELOG.md](../CHANGELOG.md) for what actually shipped and [SECURITY.md](SECURITY.md) for the current fixed/open list. This doc filters a much larger brainstorm (task management, agent memory architecture, ops maturity, multi-agent orchestration, business growth, cloud portfolio work, incorporation/SR&ED, marketing) down to the slice that's actually about *this system's* next version. Everything else in that brainstorm — SR&ED/IRAP/incorporation, insurance and salary structuring, multi-cloud portfolio labs, ad spend, D-Central's broader cooperative-infrastructure vision — is real and worth tracking, just not in a software roadmap for a WhatsApp dispatch tool. Keep those in whatever's tracking the business/academic side.

Nothing here is committed to. This is a filtered backlog to pick from, not a plan — treat it the way `docs/ROADMAP.md`'s original phase list was treated before v1: a starting point that gets reordered by what actually hurts.

## Why these categories

Today's session (2026-08-17) surfaced two concrete, real bugs — a foreign-key ordering mistake that crashed a test scenario and left production residue, and a WhatsApp group-membership issue that took a long manual SSH/SQLite excavation to root-cause. Both are used below as evidence for *why* a given item would help, not as an excuse to add tooling that just sounds mature.

## Observability (the gap that cost the most time today)

- **Tracing on the message→tool-call→response path.** Root-causing today's delivery failure meant manually reading `.jsonl` session files and querying `openclaw.sqlite` by hand over SSH. A trace view (Langfuse or similar, self-hosted to stay off a SaaS dependency) would have surfaced the `forbidden`/group-membership signal in seconds instead of ~20 minutes of investigation.
- **Centralized logs.** Right now "check the logs" means SSH in and grep across several different stores (systemd journal, openclaw's sqlite, per-session `.jsonl` files, Docker logs). Even a lightweight Loki/Grafana setup on the Pi itself (no new hardware) would collapse that into one place.
- **A real postmortem template**, used for both of today's incidents. Cheap, and the alternative is re-discovering the same lessons (the FK-delete-order mistake has now been made twice — once manually, once in test code).

## CI (currently nonexistent)

Confirmed during today's public-repo security sweep: `.github/workflows/` doesn't exist. Every check that currently runs (`tsc --noEmit`, both plugins' vitest suites, `plugins validate`, the agent-tests suite) is run by hand or by the 12-hour scheduled audit — nothing blocks a bad push before it lands on `main` and gets deployed. A GitHub Actions workflow running the deterministic checks (not the live-LLM agent-tests, which cost real money per run) on every push/PR is the highest-value, lowest-cost item on this whole list.

## Eval harness maturity

The agent-tests suite (`openclaw/agent-tests/`) already exists and is a genuinely good foundation — 14 scenarios, no `--deliver`, runs against the real gateway. Extensions worth considering once it's under more load:
- Ablation tests — strip a context source, measure the accuracy drop, to know which AGENTS.md sections are load-bearing vs. decorative
- A weekly human-scored sample of real transcripts against a small rubric (helpfulness, hallucination, leak risk) — cheap, catches drift the pass/fail scenarios can't
- Monthly reruns of the same scenario set to catch silent regressions as AGENTS.md grows (it's grown substantially every session this build has run)
- A fault-tree split on failures: retrieval miss vs. model error vs. stale doc — today's two failures were a real DB bug and stale test data, not model unreliability, and that distinction mattered for triage

## Agent knowledge scaling (RAG, scoped correctly)

AGENTS.md keeps growing every time a feature ships — it's the sole source of policy/behavior context today, and that doesn't scale indefinitely. If it becomes unwieldy:
- Plain vector RAG (pgvector — Postgres is already running on the Pi, no new service) over a versioned knowledge base of SOPs/vendor info/policy, retrieval scoped and read-only per the crew agent's existing least-privilege boundary
- Explicitly **not** GraphRAG for this system — that's real complexity that only pays off when cross-document relationship reasoning is the actual value, which isn't the shape of "what's the process for a rejected checkout." Skip it here.
- A `SYSTEM-STATUS.md`-style page updated by cron (last backup, last deploy, agent uptime) — most of the underlying data already exists (`backup_status`, `dashboard_url`, `model_usage_daily` tables); this would just be a synthesis view, not new plumbing

## Resilience (multi-agent orchestration, only if the single-agent model actually becomes the bottleneck)

- A circuit breaker between the notifier scripts and WhatsApp delivery — today's failures ran the standard 3-retry escalation regardless of whether the underlying cause was transient (listener reconnect) or structural (group removal); a breaker would stop hammering a structurally-broken path
- Redis-backed message buffering so a host reboot (like tonight's scheduled one) can't drop an in-flight WhatsApp message — currently nothing queues across a restart boundary
- If/when the single `fieldops` agent's prompt and tool count (78 tools) become unwieldy: a dispatcher/inventory/exception-escalator split via LangGraph or CrewAI (open-source, not Enterprise) rather than one agent doing everything. Not needed yet — the two-party-pilot pattern and message-draft queue have kept a single agent workable so far.

## Product features (the parts of the "growing the business" brainstorm that are actually software)

- A read-only client-facing portal (distinct from the crew portal already built) — cuts status-check calls
- Multi-crew support — `sites`/`vehicles`/`shifts` already model most of what's needed; extending to multiple concurrent crews under one dispatcher is schema-compatible, not a rebuild
- Seasonal diversification (snow removal) on the same crew/equipment/`job_types` core
- Equipment utilization analytics as a standalone report, extending the existing reports module
- Automated post-job review requests over the same WhatsApp channel
- Recurring maintenance contracts, scheduled the same way the existing preventive-maintenance feature already works

## Explicitly deferred, not forgotten

- RBAC formalization (Casbin/OPA) — current role checks are ad-hoc but small enough to still audit by hand; formalize once the role matrix actually gets more complex than the existing 5+3-tier split
- IaC (Ansible/Terraform) for redeploy — valuable once there's a second environment or a real disaster-recovery need, not before
- GraphRAG for anything crew-facing — see above, skip unless the shape of the problem changes
