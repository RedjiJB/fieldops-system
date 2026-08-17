# Roadmap: post-v1

v1 is done — see [CHANGELOG.md](../CHANGELOG.md) for what actually shipped and [SECURITY.md](SECURITY.md) for the current fixed/open list. This is the full backlog pulled out of a much larger cross-project planning session, scoped into five incremental versions (1.1–1.5) instead of one undifferentiated "v2" bucket, roughly in the order they'd actually get built — each one assumes the ones before it are either done or genuinely not needed yet, not that they happened in strict sequence.

Nothing here is committed to — this is a backlog to pick from, not a plan. Treat it the way `docs/ROADMAP.md`'s original phase list was treated before v1: a starting point that gets reordered by what actually hurts.

## Contents

- [v1.1 — Operational safety net](#v11--operational-safety-net)
- [v1.2 — Dev workflow and knowledge base](#v12--dev-workflow-and-knowledge-base)
- [v1.3 — Agent knowledge scaling](#v13--agent-knowledge-scaling)
- [v1.4 — Product growth](#v14--product-growth)
- [v1.5 — Resilience and scale-out architecture](#v15--resilience-and-scale-out-architecture)
- [Adjacent business/legal/financial context](#adjacent-businesslegalfinancial-context)

---

## v1.1 — Operational safety net

The cheapest, most proven-value increment — grounded directly in two real incidents from 2026-08-17 (a foreign-key ordering bug that crashed a test scenario and left production residue, and a WhatsApp group-membership issue that took a long manual SSH/SQLite excavation to root-cause). Everything here is about making v1 trustworthy before building more on top of it.

- **CI.** Confirmed during a repo security sweep: `.github/workflows/` doesn't exist. Nothing currently blocks a bad push before it lands on `main` and deploys. A GitHub Actions workflow running the deterministic checks (`tsc --noEmit`, both plugins' vitest suites, `plugins validate`) on every push/PR is the single highest-value, lowest-cost item on this whole list. The live-LLM agent-tests suite costs real money per run — keep that on the existing 12-hour schedule, not on every push.
- **Tracing on the message→tool-call→response path.** Root-causing the group-membership incident meant manually reading `.jsonl` session files and querying `openclaw.sqlite` by hand over SSH — roughly 20 minutes of digging that a trace view (Langfuse or similar, self-hosted) would have collapsed to seconds.
- **Centralized logs.** "Check the logs" today means grepping across the systemd journal, openclaw's sqlite, per-session `.jsonl` files, and Docker logs separately. A lightweight Loki/Grafana setup on the Pi itself (no new hardware) would put all of it in one place.
- **A blameless postmortem template**, used for every incident going forward. The FK-delete-order mistake has now been made twice — once manually, once in test code — because nothing forced writing down the lesson the first time.
- **A written backup/retention policy with a quarterly restore test.** Backups already run nightly; restore has never actually been tested.
- **Eval harness extensions**, building on the existing `agent-tests` suite (14 scenarios, no `--deliver`, already a solid foundation):
  - Ablation tests — strip a context source, measure the accuracy drop, to know which AGENTS.md sections are load-bearing vs. decorative
  - A weekly human-scored sample of real transcripts against a small rubric (helpfulness, hallucination, leak risk)
  - Monthly reruns of the same scenario set to catch silent regressions as AGENTS.md grows
  - A fault-tree split on failures: retrieval miss vs. model error vs. stale doc — today's two failures were a real DB bug and stale test data, not model unreliability, and that distinction mattered for triage
  - A/B prompt testing with basic significance checks on task-success rate, once there's enough traffic for it to mean something
  - A reproducibility packet: pin model/prompt versions + a knowledge-base snapshot hash per eval run
- **Defined SLOs** (response time, uptime) tracked like an internal SRE would, and a written escalation path (critical vs. can-wait) — the `it_escalation_roles`/critical-notification split already does a version of the latter.
- **Cost/token budget tracking per model** — the `model_usage_daily` table already gives this a head start; formalize it into an actual budget with alerts, plus vendor SLA notes on DeepSeek/Anthropic uptime and scheduled fallback-chain tests.

## v1.2 — Dev workflow and knowledge base

Near-zero cost, and compounds the longer it's delayed. This is "how the system gets worked on," not a feature for crew or management.

- **A task/work board** (GitHub Projects, or Linear if the overhead is worth it) scoped to *dev work on the system* — feature work, bugs, crew-reported issues — not day-to-day crew ops, which the WhatsApp bot already handles. Jira is overkill for a stack this size.
- **A git-backed knowledge base** (Obsidian or equivalent) as source of truth for architecture docs, SOPs, vendor contacts, and runbooks — close to what `docs/` already is, just not yet in a tool with backlink/graph views. Folder it by function (`architecture/`, `runbooks/`, `vendors/`, `incidents/`) rather than by date; both agents and humans retrieve better from stable, typed structure.
- **A `SYSTEM-STATUS.md`-style page**, updated by cron, showing last backup, last deploy, agent uptime. Most of the underlying data already exists (`backup_status`, `dashboard_url`, `model_usage_daily` tables) — this is a synthesis view, not new plumbing.
- **Every prompt/config change dated and reasoned in git**, mirrored to a knowledge-base changelog entry — incident notes go in as dated entries, linked back to the relevant runbook, becoming the postmortem trail over time.
- **RBAC formalization (Casbin/OPA)**, deferred until the role matrix actually gets more complex than the existing 5+3-tier split — current role checks are ad-hoc but still small enough to audit by hand.
- **IaC (Ansible/Terraform) for redeploy**, deferred until there's a second environment or a real disaster-recovery need.

## v1.3 — Agent knowledge scaling

AGENTS.md keeps growing every time a feature ships — it's the sole source of policy/behavior context today, and that doesn't scale indefinitely. This increment is about the point where it does become unwieldy, not before.

- **Plain vector RAG (pgvector)** over the knowledge base from v1.2 — Postgres is already running on the Pi, no new service needed. Retrieval scoped and read-only from a subset of the vault, per the crew agent's existing least-privilege boundary — this doubles as the leak-prevention boundary from earlier security work.
- **Explicitly not GraphRAG for this system.** GraphRAG earns its complexity when relationships matter more than lookup, which isn't the shape of "what's the process for a rejected checkout." Keep GraphRAG scoped to a structured cross-project registry, if one exists (see v1.5).
- **Citation-style source tracing** — every RAG answer traces back to a source doc + version, so a retrieved policy answer is auditable the way a citation is.
- **A controlled vocabulary for entities** (site, vendor, equipment — e.g. "poly," "stone dust" → canonical entity), with precision/recall spot-checks once it exists.
- **Confidence scores on RAG answers**, auto-escalating low-confidence replies to a human instead of guessing.
- **Supporting infrastructure**, roughly in order of how much they matter early vs. late:
  - Version embeddings alongside knowledge-base git commits, so re-embeds are rollback-safe
  - Periodic drift checks between vault content and what the index actually reflects
  - Auto-extract new entities from sessions, propose knowledge-base additions for approval
  - JSON-schema-constrained tool calls instead of free-text parsing
  - LLM-generated synthetic tricky messages to stress-test retrieval before real users find the gaps
  - A separate episodic ("today") vs. semantic ("always true") memory store, once plain RAG stops being enough
  - Short structured interviews with crew on when they trust vs. override the agent — qualitative signal for tuning retrieval and confidence thresholds

## v1.4 — Product growth

Follows demand, not the other way around — build these once there's an actual second client or a concrete ask, not preemptively. `sites`/`vehicles`/`shifts` already model most of what's needed for several of these; they're extensions, not rebuilds.

- **A read-only client-facing portal**, distinct from the crew portal already built — cuts status-check calls.
- **Multi-crew support** — extending to multiple concurrent crews under one dispatcher, schema-compatible with what's already built.
- **Seasonal diversification** (e.g. snow removal) on the same crew/equipment/`job_types` core.
- **Equipment utilization analytics** as a standalone report, extending the existing reports module — this also feeds the equipment-ownership-vs-rental breakeven analysis under vertical integration (v1.5).
- **An automated post-job review-request loop** over the same WhatsApp channel.
- **Recurring maintenance contracts**, scheduled the same way the existing preventive-maintenance feature already works.
- **Data-driven flagging** of clients whose properties show recurring issues, for proactive follow-up.
- **Licensing direction**: a franchise-style playbook packaging the ops model (not just the software) for a second crew or partner, or a white-label/bundle version for other trades (electricians, HVAC) reusing the same core.
- **Baseline discoverability**, since it's cheap and ties directly to having something worth showing: a case study page written for people (clear headings, skimmable structure — this is also what AI answer engines cite from), Person/Organization schema markup, and an `llms.txt`. Paid marketing and community-specific outreach belong later, funded from actual revenue — see the adjacent context section below.

## v1.5 — Resilience and scale-out architecture

Deferred until there's an actual bottleneck of the specific shape each item solves — this is the "only if it's actually needed" tier. The two-party-pilot pattern and message-draft queue have kept a single agent workable through all of v1; don't split it preemptively.

- **Multi-agent orchestration** — a dispatcher/inventory/exception-escalator split via LangGraph or CrewAI (open-source, not Enterprise), only once the single `fieldops` agent's prompt and tool count (78 tools and growing) actually become unwieldy. n8n, Langflow, or Flowise as a prototyping sandbox for new agent chains, kept separate from production. Treat SaaS orchestration control planes (Copilot Studio, CrewAI Enterprise, watsonx Orchestrate) as reference architecture to read, not infra to adopt.
- **Resilience primitives**:
  - A circuit breaker between the notifier scripts and WhatsApp delivery — today's incident ran the standard 3-retry escalation regardless of whether the cause was transient or structural; a breaker would stop hammering a structurally-broken path
  - Redis-backed message buffering so a host reboot can't drop an in-flight WhatsApp message
  - Rate-limiting crew-facing agent calls to cap runaway cost from message loops
  - mTLS between internal services and stricter network segmentation, once there's more than one deployment/node to secure
  - An admin-only health-check dashboard, never public
  - Chaos-testing the tunnel intentionally — kill Cloudflare connectivity, confirm graceful degradation against the existing `dashboard_unreachable`/`connectivity_degraded` alerts
  - Self-healing Docker health checks with auto-restart and structured incident logging
- **GraphRAG and hybrid retrieval**, scoped to a structured cross-project registry if one develops, so "what depends on X?" becomes a native query — this is the correct home for GraphRAG, not the crew bot.
- **Research-grade agent behavior**, once the basics are solid: a self-reflective pass that critiques its own draft against sources before sending, a planner/executor split, a local small-model fallback on the Pi for offline mode, a shadow-deployment mode for testing a new prompt/model version silently before cutover.
- **Vertical-integration software hooks** — these are operations decisions more than software, but have real dependencies worth flagging: the OBD/vehicle-telemetry work already noted as a future upgrade in `docs/ROADMAP.md` plugs directly into any hauling-ownership decision; direct vendor API integration is already flagged in this build's own docs as the explicit next step once volume justifies skipping the email-forward flow; a fuel/fleet card program ties into the existing cost-tracking work.
- **Wider-project integration**, if this deployment is ever used as a reference implementation for something larger: a registry doc for formal agent roles/permissions/identities, an explicit sovereignty/cost-tradeoff writeup of the self-hosted-vs-SaaS decisions already made in this build, MCP as a standard integration surface, and a forkable starter-kit version of this agent setup.

---

## Adjacent business/legal/financial context

Not software work, and not versioned above, but part of the same planning conversation this doc was pulled from — kept here as a pointer so it isn't lost:

- **SR&ED/IRAP.** SR&ED is available now as a sole proprietor (15% non-refundable against personal tax); the 35% refundable rate needs a CCPC. IRAP requires incorporation. Both are retroactive/claimable later — the actionable item *now*, regardless of entity structure, is a dated project log (hypothesis, what was tried, what failed, what was learned), since that log is what a claim runs on later.
- **Incorporation.** Ontario provincial incorporation is the likely fit for a business operating mainly in Ontario — cheap, fast, online. Get a CPA's input on structure before filing, since the tax math (salary vs. retained earnings, SR&ED eligibility) depends on it.
- **Contracting with the existing client.** Invoicing can happen now as a sole proprietor; GST/HST registration is mandatory once revenue crosses $30K in a single quarter, optional before that. If a contract needs signing before incorporation completes, a pre-incorporation contract naming "[Proposed Name] Inc., or its permitted assigns" with an assignment clause is the standard mechanism — but given how fast Ontario incorporation is, incorporating first and signing as the corp is simpler where timing allows.
- **IP terms in any client contract.** Retain ownership of the underlying platform/codebase; license the deployed instance to the client. A standard work-for-hire that assigns all IP away would block reselling or templating this system for a second client — directly relevant to the licensing direction in v1.4.
- **Salary/reinvestment structure.** Corporate-direct spending on equipment/tools/hosting is a clean deduction with no personal write-off complexity. Salary generates RRSP room and the SR&ED labour-cost basis; retained earnings sit at the lower CCPC small-business rate. A modest, defensible salary plus corporate-direct spending — not a maxed-out salary — is the usual shape when the goal is funding reinvestment.
- **Insurance.** Professional liability (E&O), general liability, and cyber liability are all genuinely relevant given this system handles a client's operational data — budget roughly $2,000–4,000/year, worth having before a second client.
- **Personal financial claims to avoid.** Personal food/lifestyle spending is not a corporate deduction at any company size — CRA reclassifies it as a taxable shareholder benefit on audit, which ends up worse than just taking it as salary.
- **Multi-cloud portfolio work** (AWS/Azure/GCP/Cloudflare reference deploys, Terraform module, cert study) is real and valuable as a separate career/portfolio track, but it's not FieldOps engineering — it doesn't belong in this repo's roadmap.
- **Paid marketing.** Small geo-targeted local ads, retargeting, and community-specific placement all belong once there's real recurring revenue to fund them from — not before, and not out of the equipment/reinvestment budget.

None of the above is legal, tax, or financial advice — the point of listing it here is so it isn't lost between conversations, not to substitute for a CPA or lawyer.
