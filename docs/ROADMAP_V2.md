# Roadmap: v2 candidates

v1 is done — see [CHANGELOG.md](../CHANGELOG.md) for what actually shipped and [SECURITY.md](SECURITY.md) for the current fixed/open list. This is the full backlog pulled out of a much larger cross-project planning session, kept broad on purpose rather than pre-filtered down to a tidy shortlist. Part 1 is the near-term, grounded-in-today's-actual-incidents set. Part 2 is the wider tiered brainstorm (professional/academic/research-grade/frontier/network/D-Central-integration/product-growth), kept close to its original shape so nothing gets silently dropped. Part 3 is the adjacent business/legal/financial context that isn't software work but is real and worth a pointer.

Nothing here is committed to — this is a backlog to pick from, not a plan. Treat it the way `docs/ROADMAP.md`'s original phase list was treated before v1: a starting point that gets reordered by what actually hurts.

## Contents

- [Part 1: Near-term, grounded in today's incidents](#part-1-near-term-grounded-in-todays-incidents)
- [Part 2: The wider backlog](#part-2-the-wider-backlog)
  - [Task, knowledge, and agent-memory architecture](#task-knowledge-and-agent-memory-architecture)
  - [Operational maturity, by tier](#operational-maturity-by-tier)
  - [Network / multi-agent orchestration](#network--multi-agent-orchestration)
  - [D-Central integration](#d-central-integration)
  - [Growing the business (the software-shaped parts)](#growing-the-business-the-software-shaped-parts)
  - [Vertical integration of the supply chain](#vertical-integration-of-the-supply-chain)
  - [Discoverability and marketing](#discoverability-and-marketing)
  - [Sequencing across all of the above](#sequencing-across-all-of-the-above)
- [Part 3: Adjacent business/legal/financial context](#part-3-adjacent-businesslegalfinancial-context)

---

## Part 1: Near-term, grounded in today's incidents

Today's session (2026-08-17) surfaced two concrete, real bugs — a foreign-key ordering mistake that crashed a test scenario and left production residue, and a WhatsApp group-membership issue that took a long manual SSH/SQLite excavation to root-cause. These items are the ones with direct evidence they'd help, not just items that sound mature.

### Observability (the gap that cost the most time today)

- **Tracing on the message→tool-call→response path.** Root-causing today's delivery failure meant manually reading `.jsonl` session files and querying `openclaw.sqlite` by hand over SSH. A trace view (Langfuse or similar, self-hosted to stay off a SaaS dependency) would have surfaced the `forbidden`/group-membership signal in seconds instead of ~20 minutes of investigation.
- **Centralized logs.** Right now "check the logs" means SSH in and grep across several different stores (systemd journal, openclaw's sqlite, per-session `.jsonl` files, Docker logs). Even a lightweight Loki/Grafana setup on the Pi itself (no new hardware) would collapse that into one place.
- **A real postmortem template**, used for both of today's incidents. Cheap, and the alternative is re-discovering the same lessons (the FK-delete-order mistake has now been made twice — once manually, once in test code).

### CI (currently nonexistent)

Confirmed during today's public-repo security sweep: `.github/workflows/` doesn't exist. Every check that currently runs (`tsc --noEmit`, both plugins' vitest suites, `plugins validate`, the agent-tests suite) is run by hand or by the 12-hour scheduled audit — nothing blocks a bad push before it lands on `main` and gets deployed. A GitHub Actions workflow running the deterministic checks (not the live-LLM agent-tests, which cost real money per run) on every push/PR is the highest-value, lowest-cost item on this whole list.

### Eval harness maturity

The agent-tests suite (`openclaw/agent-tests/`) already exists and is a genuinely good foundation — 14 scenarios, no `--deliver`, runs against the real gateway. Extensions worth considering once it's under more load:
- Ablation tests — strip a context source, measure the accuracy drop, to know which AGENTS.md sections are load-bearing vs. decorative
- A weekly human-scored sample of real transcripts against a small rubric (helpfulness, hallucination, leak risk) — cheap, catches drift the pass/fail scenarios can't
- Monthly reruns of the same scenario set to catch silent regressions as AGENTS.md grows (it's grown substantially every session this build has run)
- A fault-tree split on failures: retrieval miss vs. model error vs. stale doc — today's two failures were a real DB bug and stale test data, not model unreliability, and that distinction mattered for triage
- A/B prompt testing with basic significance checks on task-success rate, once there's enough traffic for it to mean something
- Precision/recall spot-checks on entity extraction ("poly," "stone dust" → canonical entity), relevant once/if the vocabulary work below happens
- Reproducibility packet: pin model/prompt versions + a knowledge-base snapshot hash per eval run, so a scored run can be re-run exactly later

### Agent knowledge scaling (RAG, scoped correctly)

AGENTS.md keeps growing every time a feature ships — it's the sole source of policy/behavior context today, and that doesn't scale indefinitely. If it becomes unwieldy:
- Plain vector RAG (pgvector — Postgres is already running on the Pi, no new service) over a versioned knowledge base of SOPs/vendor info/policy, retrieval scoped and read-only per the crew agent's existing least-privilege boundary
- Explicitly **not** GraphRAG for this system — that's real complexity that only pays off when cross-document relationship reasoning is the actual value, which isn't the shape of "what's the process for a rejected checkout." Skip it here; it belongs on the D-Central registry side (see below).
- A `SYSTEM-STATUS.md`-style page updated by cron (last backup, last deploy, agent uptime) — most of the underlying data already exists (`backup_status`, `dashboard_url`, `model_usage_daily` tables); this would just be a synthesis view, not new plumbing
- Every RAG answer traced back to a source doc + version, so a retrieved policy answer is auditable the way a citation is

### Resilience (multi-agent orchestration, only if the single-agent model actually becomes the bottleneck)

- A circuit breaker between the notifier scripts and WhatsApp delivery — today's failures ran the standard 3-retry escalation regardless of whether the underlying cause was transient (listener reconnect) or structural (group removal); a breaker would stop hammering a structurally-broken path
- Redis-backed message buffering so a host reboot (like tonight's scheduled one) can't drop an in-flight WhatsApp message — currently nothing queues across a restart boundary
- Rate-limit crew-facing agent calls to cap runaway cost from message loops
- If/when the single `fieldops` agent's prompt and tool count (78 tools) become unwieldy: a dispatcher/inventory/exception-escalator split via LangGraph or CrewAI (open-source, not Enterprise) rather than one agent doing everything. Not needed yet — the two-party-pilot pattern and message-draft queue have kept a single agent workable so far.

### Product features (the parts of "growing the business" that are directly software)

- A read-only client-facing portal (distinct from the crew portal already built) — cuts status-check calls
- Multi-crew support — `sites`/`vehicles`/`shifts` already model most of what's needed; extending to multiple concurrent crews under one dispatcher is schema-compatible, not a rebuild
- Seasonal diversification (snow removal) on the same crew/equipment/`job_types` core
- Equipment utilization analytics as a standalone report, extending the existing reports module
- Automated post-job review requests over the same WhatsApp channel
- Recurring maintenance contracts, scheduled the same way the existing preventive-maintenance feature already works

### Explicitly deferred, not forgotten

- RBAC formalization (Casbin/OPA) — current role checks are ad-hoc but small enough to still audit by hand; formalize once the role matrix actually gets more complex than the existing 5+3-tier split
- IaC (Ansible/Terraform) for redeploy — valuable once there's a second environment or a real disaster-recovery need, not before
- GraphRAG for anything crew-facing — see above, skip unless the shape of the problem changes

---

## Part 2: The wider backlog

Everything below is kept closer to its original brainstorm shape — broader, less pre-filtered, organized by tier (professional/academic/research-grade/frontier) the way it was originally proposed. Some items overlap with Part 1; that's intentional, Part 1 is the "start here" cut of this same material.

### Task, knowledge, and agent-memory architecture

**Task/work management.** Jira is overkill for a stack this size. Linear or a GitHub Projects board tracks FieldOps feature work, bugs, and crew-reported issues with far less overhead — and scope it to *dev work on the system*, not day-to-day crew ops (the WhatsApp bot already handles that).

**Knowledge base.** An Obsidian vault (or equivalent) as source of truth — architecture docs, SOPs, vendor contacts, runbooks — is close to what `docs/` already is for this repo, just not yet in a note-taking tool with backlink/graph views. Put it in git regardless of tool, foldered by function (`architecture/`, `runbooks/`, `vendors/`, `incidents/`) rather than by date, since both agents and humans retrieve better from stable, typed structure than a date-ordered log.

**Agent memory: RAG vs. GraphRAG.** Plain vector RAG over the knowledge base covers the large majority of what the FieldOps agent needs — vendor lookup, SOP retrieval, "what's the process for X." Postgres is already on the Pi, so pgvector is the path of least resistance, no new service. GraphRAG earns its complexity when relationships matter more than lookup — the D-Central registry, where one component depends on another depends on a protocol layer, is that shape of problem. For the crew-facing bot, GraphRAG is overkill; keep it scoped to the D-Central side (see below). Keep the crew agent's retrieval scoped and read-only from a subset of the vault — this doubles as the leak-prevention boundary from the security work already done.

**Operational management of the system itself.** Extend the existing cron-failure-alert pattern into a lightweight status doc — a `SYSTEM-STATUS.md` in the vault, updated by a cron job, showing last backup, last deploy, agent uptime. Incident notes go in the vault as dated entries, linked back to the relevant runbook — that becomes the postmortem trail.

### Operational maturity, by tier

**Professional (industry ops practices)**
1. Langfuse/LangSmith-style tracing on every WhatsApp → tool call → response
2. Grafana Loki for centralized Pi logs — uptime, latency, token spend at a glance
3. An Ansible playbook so the whole stack (OpenClaw + Docker + Cloudflare Tunnel) redeploys from git
4. GitHub Actions CI to test prompt/config changes before they hit the crew agent
5. Casbin/OPA to formalize the crew-agent vs. admin-agent split into enforced policy, not convention
6. Defined SLOs — response time, uptime — tracked like an internal SRE would
7. Every prompt/config change dated and reasoned in git, mirrored to a vault changelog
8. A written backup/retention policy with a quarterly restore test
9. Token/cost budget tracking per model (DeepSeek primary, Claude fallback) — the `model_usage_daily` table already gives this a head start
10. Vendor SLA notes on DeepSeek/Anthropic uptime, fallback logic tested on schedule
11. A defined escalation path — critical vs. can-wait — routed appropriately (the `it_escalation_roles`/critical-notification split already does a version of this)
12. A blameless postmortem template, reused for every incident (like the leak fixed earlier this build, and today's two findings)

**Academic (research-methodology grounded)**
1. A FieldOps-specific eval harness — real crew messages, expected actions, pass/fail scoring (the existing `agent-tests` suite is this, already)
2. Ablation tests: strip context sources one at a time, measure the retrieval-accuracy drop
3. A weekly human-scored transcript sample against a rubric (helpfulness, hallucination, leak risk)
4. A controlled vocabulary for entities (site, vendor, equipment) before any graph work scales
5. A/B prompt testing with basic significance checks on task-success rate
6. Fault-tree analysis on failures — retrieval miss vs. model error vs. stale doc
7. Every RAG answer traces to a source doc + version, like a citation standard
8. A reproducibility packet: pinned model/prompt versions + a vault snapshot hash
9. Short structured interviews with crew on when they trust vs. override the agent
10. Precision/recall spot-checks on entity extraction ("poly," "stone dust" → canonical entity)
11. Monthly benchmark reruns to catch silent accuracy drift as the vault grows
12. Prompting grounded in published patterns (ReAct, self-consistency) over ad hoc tweaking

**Research-grade / emerging**
1. GraphRAG for cross-referencing a larger structured registry, if one develops — not for the crew bot
2. Hybrid retrieval: pgvector + graph traversal combined
3. Separate episodic ("today") vs. semantic ("always true") agent memory stores
4. A self-reflective agent pass: critique its own draft against sources before sending
5. A planner/executor split — one agent parses intent, another executes tools
6. Confidence scores on RAG answers, auto-escalating low-confidence replies to a human
7. Auto-extract new entities from sessions, propose knowledge-base additions for approval
8. Route by task complexity: simple lookups → cheap model, complex reasoning → stronger fallback (already the shape of the existing 5-provider chain)
9. Version embeddings alongside knowledge-base git commits so re-embeds are rollback-safe
10. LLM-generated synthetic tricky messages to stress-test before real users find the gaps
11. Periodic drift checks between vault content and what the index reflects
12. JSON-schema-constrained tool calls instead of free-text parsing

**Frontier (experimental)**
1. A local small-model fallback on the Pi for offline mode when the tunnel/APIs are down
2. Formal testable non-disclosure constraints, not just prompt-based leak prevention (this build's existing infra-non-disclosure work is the prompt-based version — a testable/enforced version is the frontier step up)
3. The agent proposes new SOP entries when it spots a repeated unresolved pattern
4. A shadow deployment mode — a new prompt/model version runs silently before cutover
5. Self-healing Docker health checks with auto-restart + structured incident logging
6. Agent-authored test cases closing the loop with the eval harness above

### Network / multi-agent orchestration

1. n8n as connective tissue — a node-based canvas wired into OpenClaw webhooks; light enough for the Pi, fits the existing tunnel setup
2. Langflow or Flowise as a prototyping sandbox for new agent chains, kept separate from production
3. CrewAI (open-source, not Enterprise) for role-based squads — e.g. dispatcher, inventory-checker, exception-escalator agents
4. LangGraph for stateful multi-turn loops — anywhere an agent needs to track something (an order discrepancy, a shift extension) across several messages
5. Treat SaaS agent-orchestration control planes (Copilot Studio, CrewAI Enterprise, watsonx Orchestrate) as reference architecture to read, not infra to adopt — centralizing on someone else's control plane is a real dependency, not a small one
6. An AutoGen-style agent-to-agent conversation pattern for an admin/diagnostic agent talking to a monitoring agent before escalating to a human
7. Circuit breaker pattern between OpenClaw and downstream APIs — auto-fallback on repeated timeouts
8. Rate-limit crew-facing agent calls to cap runaway cost from message loops
9. mTLS between internal services, once there's more than one deployment/node to secure
10. A health-check dashboard exposed only on the admin route, never public
11. Chaos-test the tunnel intentionally — kill Cloudflare connectivity, confirm graceful degradation (this build's `dashboard_unreachable`/`connectivity_degraded` alerts already give this a target to test against)
12. Queue-based message buffering (Redis) so a Pi reboot doesn't drop in-flight WhatsApp messages

### D-Central integration

FieldOps already sits inside a larger cooperative-infrastructure project; the items below are where this specific system connects to that larger one, without pulling the larger one's full scope into this repo.

1. A registry doc for formal agent roles, permissions, and identities, in whatever naming convention the wider project uses
2. Document the self-hosted-vs-SaaS tool decisions this build already made (no direct vendor ordering, Cloudflare Tunnel over port-forwarding, DeepSeek-primary fallback chain) as an explicit sovereignty/cost tradeoff writeup, not just as config
3. GraphRAG scoped to a structured cross-project registry, if one exists, so "what depends on X?" becomes a native query — this is the correct home for GraphRAG, not the crew bot
4. Generalize this build's non-disclosure/leak-prevention rules into a reusable template for future deployments
5. Position this deployment as a reference implementation feeding real operational data back into a formal spec, if one is being written
6. Version and hash prompts/configs alongside any wider-project status audits, so capability claims get the same designed-vs-executed honesty check this build already applies to itself
7. MCP as the standard interface between any wider set of services and any agent — one integration surface instead of bespoke wiring per tool
8. A forkable starter-kit version of this build's agent setup, if other deployments are ever spun up from it

### Growing the business (the software-shaped parts)

1. Turn FieldOps into a licensable product for other crews in the same trade or adjacent ones — SaaS or white-label
2. A client-facing read-only portal, cutting down status-check calls (same item as Part 1, listed here for completeness)
3. Multi-crew support — the schema already models sites/vehicles; extend to multiple concurrent crews under one dispatcher
4. Seasonal service diversification (e.g. snow removal) using the same crew/equipment tracking core
5. Data-driven flagging of clients whose properties show recurring issues, for proactive follow-up
6. Equipment utilization analytics as a standalone insight product
7. An automated post-job review-request loop over the same WhatsApp channel
8. A franchise-style playbook packaging the ops model (not just the software) for a second crew or partner
9. Recurring-revenue maintenance contracts, tracked and scheduled automatically
10. Use the system's visibility as a retention lever — fair, transparent hours/performance tracking
11. Bundle the whole stack as a starter kit for other trades (electricians, HVAC), reusing the same core

### Vertical integration of the supply chain

Listed for completeness — these are operations/business decisions more than software features, but several have a direct software dependency worth flagging:

1. Direct relationships with aggregate/material suppliers for bulk pricing instead of per-job ordering
2. In-house material holding to smooth supply timing
3. Owning/leasing hauling capacity instead of renting per job — the OBD/vehicle-telemetry work already scoped as a future upgrade (see `docs/ROADMAP.md`) plugs directly into this
4. Model the equipment-ownership-vs-rental breakeven point using the utilization data the analytics feature above would produce
5. Materials brokering at volume for smaller crews
6. Arrange direct disposal contracts instead of ad hoc runs, tracked via the existing documents module
7. In-house equipment maintenance/repair, feeding data back into the existing preventive-maintenance feature
8. Direct vendor API integration — this build's own docs already flag this as the explicit next step once volume justifies skipping the email-forward flow
9. A fuel/fleet card program once vehicle count grows, tied into the existing cost-tracking work
10. A private-label materials relationship, leveraging existing vendor accounts
11. Financing equipment leases to smaller outfits, if a cooperative-credit mechanism exists to underwrite it

### Discoverability and marketing

Kept condensed here since this is genuinely a different track from system engineering, but present rather than dropped.

**Organic / near-zero cost**
- A case study page for this deployment, written for people, not just for search — clear headings, skimmable structure, real content (structured, well-organized content is what AI answer engines cite from)
- A Person/Organization schema + `sameAs` links on wherever this work is written up, since answer engines preferentially cite identifiable people and orgs over anonymous pages
- An `llms.txt` — it won't guarantee citations by itself, but writing one forces a clean, plain-language summary of the most important pages, which is useful regardless
- LinkedIn posts, a referral ask to the existing client, a Google Business Profile listing
- Short demo clips of the agent handling a real (anonymized) interaction — a genuinely shareable hook
- "Build in public" style updates tied to real milestones, not a constant stream

**Paid (once there's real recurring revenue to fund it from — not before)**
- Small geo-targeted local ads once a case study and a second reference point exist
- Retargeting anyone who's viewed the case study page
- Community-specific placement (diaspora, cooperative, or trade-association channels) if that's the actual target audience for the next few clients

### Sequencing across all of the above

A rough "what before what," not a schedule:
1. Start with the Part 1 items — CI first, tracing/logging second, since both are cheap and both would have saved real time today
2. Task board (GitHub Projects) and a git-backed knowledge base are close to zero-cost and worth doing early, since they compound the longer they're delayed
3. pgvector RAG only once AGENTS.md is genuinely hard to maintain by hand — not preemptively
4. GraphRAG, multi-agent orchestration (CrewAI/LangGraph), and anything D-Central-registry-shaped: defer until there's an actual bottleneck of the specific shape each one solves
5. Product-growth features (client portal, multi-crew, seasonal) follow demand, not the other way around
6. Vertical-integration and marketing items are business decisions gated on revenue/volume, not on this system's engineering readiness

---

## Part 3: Adjacent business/legal/financial context

Not software work, but part of the same planning conversation this doc was pulled from, and worth a pointer here so it isn't lost:

- **SR&ED/IRAP.** SR&ED is available now as a sole proprietor (15% non-refundable against personal tax); the 35% refundable rate needs a CCPC. IRAP requires incorporation. Both are retroactive/claimable later — the actionable item *now*, regardless of entity structure, is a dated project log (hypothesis, what was tried, what failed, what was learned) for this and related work, since that log is what a claim runs on later.
- **Incorporation.** Ontario provincial incorporation is the likely fit for a business operating mainly in Ontario — cheap, fast, online. Get a CPA's input on structure before filing, since the tax math (salary vs. retained earnings, SR&ED eligibility) depends on it.
- **Contracting with the existing client.** Invoicing can happen now as a sole proprietor; GST/HST registration is mandatory once revenue crosses $30K in a single quarter, optional (and often worthwhile) before that. If a contract needs to be signed before incorporation completes, a pre-incorporation contract naming "[Proposed Name] Inc., or its permitted assigns" with an assignment clause is the standard mechanism — but given how fast Ontario incorporation is, incorporating first and signing as the corp is simpler where timing allows.
- **IP terms in any client contract.** Retain ownership of the underlying platform/codebase; license the deployed instance to the client. A standard work-for-hire that assigns all IP away would block reselling or templating this system for a second client.
- **Salary/reinvestment structure.** Corporate-direct spending on equipment/tools/hosting is a clean deduction with no personal write-off complexity. Salary is what generates RRSP room and the SR&ED labour-cost basis; retained earnings sit at the lower CCPC small-business rate. A modest, defensible salary plus corporate-direct spending — not a maxed-out salary — is the usual shape when the goal is funding reinvestment.
- **Insurance.** Professional liability (E&O), general liability, and cyber liability are all genuinely relevant given this system handles a client's operational data — budget roughly $2,000–4,000/year, worth having before scaling to a second client.
- **Personal financial claims to be careful about.** Personal food/lifestyle spending is not a corporate deduction at any company size — CRA reclassifies it as a taxable shareholder benefit on audit, which ends up worse than just taking it as salary. Keep the corp's deductions to genuine business expenses.
- **Multi-cloud portfolio work** (AWS/Azure/GCP/Cloudflare reference deploys, Terraform module, cert study) is real and valuable as a separate career/portfolio track, but it's not FieldOps engineering — it doesn't belong in this repo's roadmap.

None of the above is legal, tax, or financial advice — the point of listing it here is just so it isn't lost between conversations, not to substitute for a CPA or lawyer.
