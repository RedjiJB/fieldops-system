# Roadmap: post-v1

v1 is done — see [CHANGELOG.md](../CHANGELOG.md) for what actually shipped and [SECURITY.md](SECURITY.md) for the current fixed/open list. This is the full backlog from a much larger cross-project planning session, scoped into nine incremental versions (1.1–1.9) rather than one undifferentiated "v2" bucket, roughly in the order they'd get built — each one assumes the ones before it are either done or genuinely not needed yet, not that they happen in strict calendar sequence. This revision reintegrates everything that got compressed out or genericized in the first pass (see the note at the end of each section that had something added back) — nothing from the original brainstorm is dropped anymore, including the D-Central-specific and marketing/business content that isn't FieldOps engineering scope, which stays in Part 3.

Nothing here is committed to — this is a backlog to pick from, not a plan. Treat it the way `docs/ROADMAP.md`'s original phase list was treated before v1: a starting point that gets reordered by what actually hurts.

## Contents

- [v1.1 — Operational safety net and governance](#v11--operational-safety-net-and-governance)
- [v1.2 — Dev workflow and knowledge base](#v12--dev-workflow-and-knowledge-base)
- [v1.3 — Eval harness, research rigor, and academic output](#v13--eval-harness-research-rigor-and-academic-output)
- [v1.4 — Agent knowledge scaling and reasoning architecture](#v14--agent-knowledge-scaling-and-reasoning-architecture)
- [v1.5 — Product growth](#v15--product-growth)
- [v1.6 — Discoverability and marketing](#v16--discoverability-and-marketing)
- [v1.7 — Network and multi-agent orchestration](#v17--network-and-multi-agent-orchestration)
- [v1.8 — Frontier and wider-project integration](#v18--frontier-and-wider-project-integration)
- [v1.9 — Vertical integration of the supply chain](#v19--vertical-integration-of-the-supply-chain)
- [Part 3: Adjacent business/legal/financial context](#part-3-adjacent-businesslegalfinancial-context)

---

## v1.1 — Operational safety net and governance

The cheapest, most proven-value increment — grounded directly in two real incidents from 2026-08-17 (a foreign-key ordering bug that crashed a test scenario and left production residue, and a WhatsApp group-membership issue that took a long manual SSH/SQLite excavation to root-cause). Everything here is about making v1 trustworthy and governable before building more on top of it.

- **CI.** Confirmed during a repo security sweep: `.github/workflows/` doesn't exist. Nothing currently blocks a bad push before it lands on `main` and deploys. A GitHub Actions workflow running the deterministic checks (`tsc --noEmit`, both plugins' vitest suites, `plugins validate`) on every push/PR is the single highest-value, lowest-cost item on this whole list. The live-LLM agent-tests suite costs real money per run — keep that on the existing 12-hour schedule, not on every push.
- **Tracing on the message→tool-call→response path.** Root-causing the group-membership incident meant manually reading `.jsonl` session files and querying `openclaw.sqlite` by hand over SSH — roughly 20 minutes of digging that a trace view (Langfuse or similar, self-hosted) would have collapsed to seconds.
- **Centralized logs.** "Check the logs" today means grepping across the systemd journal, openclaw's sqlite, per-session `.jsonl` files, and Docker logs separately. A lightweight Loki/Grafana setup on the Pi itself (no new hardware) would put all of it in one place.
- **A blameless postmortem template**, used for every incident going forward. The FK-delete-order mistake has now been made twice — once manually, once in test code — because nothing forced writing down the lesson the first time.
- **Named incident severity levels (SEV1–3)**, so "the bot leaked infra info" (an actual past incident this build fixed) and "a typo in a reply" aren't handled with the same urgency or the same postmortem weight.
- **A written backup/retention policy with a quarterly restore test.** Backups already run nightly; restore has never actually been tested.
- **Runbook-as-code.** Every SOP that's currently a Markdown doc in `docs/` becomes an executable script or Ansible task where it plausibly could be — a runbook that can be run is a runbook that's actually been tested.
- **A formal on-call rotation**, once there's more than one person who could respond to an incident.
- **A change-advisory step** — even solo, a 5-minute "what could break" checklist before a deploy, cheap insurance against exactly the kind of FK-ordering mistake that's already happened twice.
- **A written PIPEDA data-retention policy.** Flagged as the one item in this section that's a real compliance gap, not just operational nice-to-have — this system already stores real personal data (phone numbers, location pings, pay/hours records) for real people, and there's currently no written policy on how long any of it is retained or when it's purged.
- **A quarterly access review** — who and what still holds admin-agent permissions, service tokens, and SSH keys.
- **Defined SLOs** (response time, uptime) tracked like an internal SRE would, and a written escalation path (critical vs. can-wait) — the `it_escalation_roles`/critical-notification split already does a version of the latter.
- **Cost/token budget tracking per model** — the `model_usage_daily` table already gives this a head start; formalize it into an actual budget with alerts, plus vendor SLA notes on DeepSeek/Anthropic uptime and scheduled fallback-chain tests.

*Reintegrated here: the entire "Professional — more" batch (runbook-as-code, on-call rotation, change-advisory checklist, PIPEDA policy, SEV1–3 levels, quarterly access review), all previously dropped.*

## v1.2 — Dev workflow and knowledge base

Near-zero cost, and compounds the longer it's delayed. This is "how the system gets worked on," not a feature for crew or management.

- **A task/work board** (GitHub Projects, or Linear if the overhead is worth it) scoped to *dev work on the system* — feature work, bugs, crew-reported issues — not day-to-day crew ops, which the WhatsApp bot already handles. Jira is overkill for a stack this size.
- **A git-backed knowledge base** (Obsidian or equivalent) as source of truth for architecture docs, SOPs, vendor contacts, and runbooks — close to what `docs/` already is, just not yet in a tool with backlink/graph views. Folder it by function (`architecture/`, `runbooks/`, `vendors/`, `incidents/`) rather than by date; both agents and humans retrieve better from stable, typed structure.
- **A `SYSTEM-STATUS.md`-style page**, updated by cron, showing last backup, last deploy, agent uptime. Most of the underlying data already exists (`backup_status`, `dashboard_url`, `model_usage_daily` tables) — this is a synthesis view, not new plumbing.
- **Every prompt/config change dated and reasoned in git**, mirrored to a knowledge-base changelog entry — incident notes go in as dated entries, linked back to the relevant runbook, becoming the postmortem trail over time.
- **RBAC formalization (Casbin/OPA)**, deferred until the role matrix actually gets more complex than the existing 5+3-tier split — current role checks are ad-hoc but still small enough to audit by hand.
- **IaC (Ansible/Terraform) for redeploy**, deferred until there's a second environment or a real disaster-recovery need.

## v1.3 — Eval harness, research rigor, and academic output

Builds on the existing `agent-tests` suite (14 scenarios, no `--deliver`, already a solid foundation), and extends into treating the whole build as a legitimate research/portfolio artifact, not just working code.

- Ablation tests — strip a context source, measure the accuracy drop, to know which AGENTS.md sections are load-bearing vs. decorative
- A weekly human-scored sample of real transcripts against a small rubric (helpfulness, hallucination, leak risk)
- Monthly reruns of the same scenario set to catch silent regressions as AGENTS.md grows
- A fault-tree split on failures: retrieval miss vs. model error vs. stale doc — today's two failures were a real DB bug and stale test data, not model unreliability, and that distinction mattered for triage
- A/B prompt testing with basic significance checks on task-success rate, once there's enough traffic for it to mean something
- A reproducibility packet: pin model/prompt versions + a knowledge-base snapshot hash per eval run
- **Prompting grounded in published patterns (ReAct, self-consistency) over ad hoc tweaking** — audit the current AGENTS.md prompt structure against published agent-prompting research rather than continuing to tune by feel.
- **A formal taxonomy of failure modes specific to trade-terminology parsing** — "poly," "stone dust," and similar domain jargon are a distinct failure class from general misunderstanding, worth naming and tracking separately.
- **Publish the eval harness methodology as a portfolio artifact** — this is genuinely distinctive applied work, worth a standalone writeup independent of the codebase itself.
- **A comparative DeepSeek-vs-Claude fallback performance writeup** — real data already exists in `model_usage_daily`; this could be a short, real research note rather than a hypothetical.
- **A formal literature-review section** in the docs, citing the actual agent-safety and RAG-eval papers the design choices here are drawing from (even implicitly).
- **Inter-rater reliability tracking**, if a second person ever scores transcripts alongside the weekly human-scored sample above.
- **Treat the whole system as a living case study** — this framing is free and makes every other item in this section more valuable, since it turns operational work into reusable material.

*Reintegrated here: the entire "Academic — more" batch, plus two stragglers from the original Academic tier (ReAct/self-consistency grounding, formal failure-mode taxonomy) that were dropped from the first pass.*

## v1.4 — Agent knowledge scaling and reasoning architecture

AGENTS.md keeps growing every time a feature ships — it's the sole source of policy/behavior context today, and that doesn't scale indefinitely. This increment is about the point where it does become unwieldy, not before.

- **Plain vector RAG (pgvector)** over the knowledge base from v1.2 — Postgres is already running on the Pi, no new service needed. Retrieval scoped and read-only from a subset of the vault, per the crew agent's existing least-privilege boundary — this doubles as the leak-prevention boundary from earlier security work.
- **Explicitly not GraphRAG for this system.** GraphRAG earns its complexity when relationships matter more than lookup, which isn't the shape of "what's the process for a rejected checkout." Keep GraphRAG scoped to a structured cross-project registry, if one exists (see v1.8).
- **Citation-style source tracing** — every RAG answer traces back to a source doc + version, so a retrieved policy answer is auditable the way a citation is.
- **A controlled vocabulary for entities** (site, vendor, equipment — e.g. "poly," "stone dust" → canonical entity), with precision/recall spot-checks once it exists.
- **Confidence scores on RAG answers**, auto-escalating low-confidence replies to a human instead of guessing.
- **Route by task complexity** — simple lookups go to the cheap model, complex reasoning to the stronger fallback. This is already roughly the shape of the existing 5-provider DeepSeek→Claude chain; the v1.4 version is making that routing logic explicit and RAG-aware rather than purely a failure-driven fallback.
- **Retrieval-augmented tool selection** — the agent picks which tool to call partly based on retrieved examples of past successful calls in similar situations, not just the tool's own description.
- **Speculative execution** — pre-fetch likely next tool calls during a multi-step exception flow (e.g. an overdue-checkout escalation), so the common path feels faster without changing the confirm-before-execute gate itself.
- **A nightly memory-consolidation job** — summarize the day's WhatsApp threads into knowledge-base entries, human-reviewed before merge. This is the natural companion to `export-nightly-transcripts.mjs`, which already produces the raw material.
- Supporting infrastructure, roughly in order of how much it matters early vs. late:
  - Version embeddings alongside knowledge-base git commits, so re-embeds are rollback-safe
  - Periodic drift checks between vault content and what the index actually reflects
  - Auto-extract new entities from sessions, propose knowledge-base additions for approval
  - JSON-schema-constrained tool calls instead of free-text parsing
  - LLM-generated synthetic tricky messages to stress-test retrieval before real users find the gaps — including non-English phrasing, sarcasm, and urgent-vs-casual tone variation, via synthetic crew personas rather than one generic "tricky message" generator
  - A separate episodic ("today") vs. semantic ("always true") memory store, once plain RAG stops being enough
  - Short structured interviews with crew on when they trust vs. override the agent — qualitative signal for tuning retrieval and confidence thresholds

*Reintegrated here: task-complexity model routing, retrieval-augmented tool selection, speculative execution, and the nightly memory-consolidation job, all previously dropped from the Research-grade tier; the synthetic-persona detail was also restored into the existing synthetic-message bullet.*

## v1.5 — Product growth

Follows demand, not the other way around — build these once there's an actual second client or a concrete ask, not preemptively. `sites`/`vehicles`/`shifts` already model most of what's needed for several of these; they're extensions, not rebuilds.

- **A read-only client-facing portal**, distinct from the crew portal already built — cuts status-check calls.
- **Multi-crew support** — extending to multiple concurrent crews under one dispatcher, schema-compatible with what's already built.
- **Seasonal diversification** (e.g. snow removal) on the same crew/equipment/`job_types` core.
- **Equipment utilization analytics** as a standalone report, extending the existing reports module — this also feeds the equipment-ownership-vs-rental breakeven analysis under vertical integration (v1.9).
- **An automated post-job review-request loop** over the same WhatsApp channel.
- **Recurring maintenance contracts**, scheduled the same way the existing preventive-maintenance feature already works.
- **Data-driven flagging** of clients whose properties show recurring issues, for proactive follow-up.
- **Licensing direction**: a franchise-style playbook packaging the ops model (not just the software) for a second crew or partner, or a white-label/bundle version for other trades (electricians, HVAC) reusing the same core.
- **Crew retention as a designed lever, not a side effect** — the system's existing visibility into hours/performance is already fair and transparent by construction; make that an explicit retention pitch to crew, since turnover cost is real and this is a genuine differentiator over ad hoc scheduling.
- **A grant/pilot funding angle worth tracking alongside product growth** — Ontario cooperative-development grants, if the business ever formalizes toward a cooperative structure. See Part 3 for the financial/legal mechanics; this is just the product-growth-side pointer to it.

*Reintegrated here: crew retention as an explicit lever, and the coop-grant funding angle — both previously dropped.*

## v1.6 — Discoverability and marketing

Kept as its own increment rather than folded into v1.5, since it's a genuinely large set of tactics and deserves its own scope boundary: **organic tactics are low/no-cost and can start any time; paid tactics are gated on real recurring revenue existing first**, not funded from the equipment/reinvestment budget. Organized the way the original brainstorm organized it — by audience/register — since that structure is doing real work (a Chamber of Commerce listing and a Show HN post are not interchangeable).

### Organic

**Professional register**
1. LinkedIn company page for the venture, regular technical posts
2. A one-page case study, shared with Ottawa trade associations
3. A referral incentive for the existing client to introduce other owners
4. A Google Business Profile listing
5. A business card with a QR code linking to a live case-study page
6. Cold outreach email using the case study, targeted at Ottawa trade firms
7. Ottawa Chamber of Commerce membership + directory listing
8. A booth or table at a local trade/home show
9. A short testimonial video from the client
10. A direct-mail postcard to a short list of target businesses
11. A sponsored mention in a local trade association newsletter

**Academic register**
1. Present the case study at a relevant student competition (e.g. Algonquin's Crunch)
2. A poster/demo at a capstone showcase
3. A guest demo for a relevant course — indirect advertising via network-building
4. Pitch a features spotlight to the school's applied-research office
5. A short paper/writeup for a student research journal
6. A LinkedIn thought-leadership series drawn from the lab writeups
7. Present at a local startup advisory network as a student-founder case study
8. A demo-day presentation, if a relevant one exists
9. Co-write an applied research note with a professor
10. A public SR&ED-style technical narrative post — doubles as documentation and credibility content
11. An academic-partnership announcement with the relevant entrepreneurship center
12. Pitch an alumni newsletter feature

**Frontier register**
1. `llms.txt` + Person/Organization schema so AI search surfaces the work
2. Short demo videos of the agent handling real (anonymized) crew messages
3. Open-source a non-sensitive component with a strong README
4. A "build in public" thread documenting real milestones
5. A short-form video hook — "an AI agent runs a landscaping crew's WhatsApp" is a genuinely shareable premise
6. A founder newsletter/Substack tied to the technical narrative
7. Podcast guest spots on small-business or Canadian-tech shows
8. A local tech meetup demo
9. Cross-post the case study to niche communities where it's genuinely relevant
10. Submit to any OpenClaw/agent-tooling community showcases

**Cooperative/community register** (if the D-Central framing becomes part of the pitch)
1. A landing page explaining the cooperative/sovereignty philosophy as real differentiation
2. Explicit "Powered by [cooperative infrastructure]" branding
3. Diaspora community outreach, if that's an aligned audience
4. Cross-promote related ventures once more than one exists
5. Honest, public progress updates as a trust-building habit
6. Present the cooperative model at an Ontario co-op development event
7. A "why cooperative infrastructure" explainer, positioned against SaaS competitors
8. Local sustainability/cooperative business fair participation
9. A one-page manifesto for first-contact conversations
10. Mutual-aid framing for community-level outreach
11. Repurpose the case study directly into coop grant application materials
12. Time milestone announcements to real technical proof points, not a content calendar

### Paid (funded from actual revenue, not before)

**Professional register**: geo-targeted Meta/Instagram ads to local trade-business owners; LinkedIn Ads targeted at owner-operators; Google Ads Performance Max; retargeting pixel on the case-study page; LinkedIn Sales Navigator + InMail outreach; Nextdoor local business ads; lookalike audiences built from the existing client's profile; a small boosted post in local small-business Facebook Groups.

**Academic register**: LinkedIn ads targeted at relevant alumni/entrepreneurship networks; a sponsored slot in a student entrepreneurship newsletter; targeted ads around a relevant competition's audience; retargeting anyone who viewed the academic case study.

**Frontier register**: a sponsored placement in an AI-agent/OpenClaw community newsletter or Discord; a Show HN post (algorithmic, not paid, but frontier-native distribution regardless); a Product Hunt launch tied to a real milestone; a lookalike audience built from GitHub follower/engagement data.

**Cooperative/community register**: Meta/Instagram ads targeted at diaspora community groups, if relevant; sponsored content in a diaspora-focused or cooperative-development newsletter; retargeting anyone who viewed the manifesto page.

*Reintegrated here: essentially the entire marketing/advertising brainstorm, previously compressed to two sentences. Kept as tight per-register lists rather than one flat 100-item dump, matching how it was originally organized. Every individual paid-ads platform variant from the original (TikTok, YouTube pre-roll, Meta Advantage+, campus digital signage, and similar) is folded into the representative items above rather than listed exhaustively — the tactic families are all present even where the exact platform list was trimmed for length.*

## v1.7 — Network and multi-agent orchestration

Deferred until there's an actual bottleneck of the specific shape each item solves — the two-party-pilot pattern and message-draft queue have kept a single agent workable through all of v1; don't split it preemptively.

- **Multi-agent orchestration** — a dispatcher/inventory/exception-escalator split via LangGraph or CrewAI (open-source, not Enterprise), only once the single `fieldops` agent's prompt and tool count (78 tools and growing) actually become unwieldy. n8n, Langflow, or Flowise as a prototyping sandbox for new agent chains, kept separate from production. Treat SaaS orchestration control planes (Copilot Studio, CrewAI Enterprise, watsonx Orchestrate) as reference architecture to read, not infra to adopt.
- **An AutoGen-style agent-to-agent conversation pattern** — a concrete use case: an admin/diagnostic agent talking to a monitoring agent before escalating to a human, rather than a single agent trying to reason about its own infrastructure state inline.
- **Resilience primitives**:
  - A circuit breaker between the notifier scripts and WhatsApp delivery — today's incident ran the standard 3-retry escalation regardless of whether the cause was transient or structural; a breaker would stop hammering a structurally-broken path
  - Redis-backed message buffering so a host reboot can't drop an in-flight WhatsApp message
  - Rate-limiting crew-facing agent calls to cap runaway cost from message loops
  - mTLS between internal services and stricter network segmentation, once there's more than one deployment/node to secure
  - **Hard network segmentation specifically**: the crew agent and any future admin/diagnostic agent live on separate Docker networks, not just separated by prompt convention — containing a compromised agent's blast radius structurally rather than by policy alone
  - An admin-only health-check dashboard, never public
  - Chaos-testing the tunnel intentionally — kill Cloudflare connectivity, confirm graceful degradation against the existing `dashboard_unreachable`/`connectivity_degraded` alerts
  - Self-healing Docker health checks with auto-restart and structured incident logging
- **DID-addressable agent identity** — treat each agent as a cryptographically-identified actor, signed the same way any broader mesh-node identity system would sign messages, if this deployment ever needs to interoperate with agents outside its own Docker network.
- **Mesh-aligned topology**, if this ever needs to scale beyond one Pi — an edge-agent/regional-coordinator/hub-reasoning-layer split rather than one flat agent, modeled on a general edge/regional/hub network pattern.
- **A federated agent network across future deployments**, reusing whatever lightweight federation protocol (e.g. an ActivityPub-inspired approach) the broader project already uses elsewhere — realistically a post-graduation-timeframe item, not near-term.
- **A workflow-scheduler reference model** (e.g. studying how something like Orkes Conductor handles distributed task scheduling) as design input for how a wider multi-node system eventually schedules agent tasks, without adopting the SaaS product itself.

*Reintegrated here: the AutoGen-style pattern, hard network segmentation as its own explicit item (not folded generically into "network segmentation"), DID-addressable identity, mesh-aligned topology, federated agent networking, and the workflow-scheduler reference model — all previously dropped or genericized.*

## v1.8 — Frontier and wider-project integration

The furthest-out tier — genuinely speculative, and most of it is explicitly not for the crew-facing bot. Kept here rather than deleted because naming a frontier idea early is cheap, and because several of these only make sense in the context of a larger project this deployment might feed into later.

- **GraphRAG and hybrid retrieval**, scoped to a structured cross-project registry if one develops, so "what depends on X?" becomes a native query — this is the correct home for GraphRAG, not the crew bot.
- **Research-grade agent behavior**: a self-reflective pass that critiques its own draft against sources before sending; a planner/executor split; a local small-model fallback on the Pi for offline mode when the tunnel/APIs are down; a shadow-deployment mode for testing a new prompt/model version silently before cutover.
- **Federated agent memory** across multiple deployments of this system, if more than one ever exists.
- **Formal, testable non-disclosure constraints** — this build already has prompt-based infra-non-disclosure rules (see `docs/SECURITY.md`); the frontier version is a constraint that's independently testable/enforced rather than relying on the prompt holding.
- **The agent proposes new SOP entries** when it spots a repeated unresolved pattern, for human approval — closing the loop between "the agent noticed something" and "the knowledge base reflects it."
- **Agent-to-agent negotiation prototypes**, if a broader governance layer (e.g. a DAO-style voting mechanism) ever exists for the agents to negotiate within.
- **Agent actions cryptographically attributed** via a DID/verifiable-credential identity stack, if one exists at the broader project level.
- **Graph-of-thought reasoning** for genuinely complex multi-hop queries, once/if there's a graph (see GraphRAG above) worth reasoning over that way.
- **Live IoT/sensor fusion** feeding into the knowledge graph, once real field hardware/telemetry exists beyond WhatsApp shared location.
- **Field-level redaction in the graph**, so even privileged/admin queries can't surface certain PII fields — a stronger version of the existing role-scoped retrieval boundary.
- **Self-healing infra** (already partly covered in v1.7) extended with structured incident logging that feeds directly back into the postmortem trail from v1.1.
- **Agent-authored test cases**, closing the loop with the eval harness in v1.3 — the agent proposes its own regression tests based on real interactions it handled.
- **Wider-project integration**, if this deployment is ever used as a reference implementation for something larger:
  - A registry doc for formal agent roles, permissions, and identities
  - An explicit sovereignty/cost-tradeoff writeup of the self-hosted-vs-SaaS decisions already made in this build (no direct vendor ordering, Cloudflare Tunnel over port-forwarding, DeepSeek-primary fallback chain), measured against whatever the broader project's sovereignty/cooperative principles are, not just described as a config choice
  - MCP as a standard integration surface between any wider set of services and any agent, instead of bespoke wiring per tool
  - A forkable starter-kit template so a future deployment can be spun up in a day
  - A capability-tiers doc — what an agent can do at a low trust level vs. a high one, if a reputation/trust system exists at the broader project level to tie it to
  - Rolling agent cost accounting into whatever micro-economy or ledger the broader project uses, if one exists, so usage is a shared line item rather than a personal bill
  - Cross-referencing this build's governance rules with any broader project-level governance doc, so the same rules apply to human and agent actors uniformly
  - An agent incident-disclosure policy consistent with whatever transparency principles the broader project holds itself to
- **Speculative hardware/crypto frontier items**, listed for completeness rather than near-term planning: on-device speech-to-text for offline voice check-ins; zero-knowledge proofs so crew location/hours can be verified without exposing raw GPS; agent-negotiated equipment-sharing between job sites; predictive-maintenance agents fed by real equipment telemetry, once that hardware exists; cross-deployment agent reputation scoring; self-provisioning agents that request new tool access via a formal vote rather than a manual grant.

*Reintegrated here: essentially the full original Frontier tier (federated memory, testable non-disclosure, agent-proposed SOPs, agent-to-agent negotiation, DID/VC attribution, graph-of-thought, IoT/sensor fusion, field-level redaction, agent-authored test cases) and the full D-Central-more batch (forkable template, capability tiers, cost accounting, governance cross-reference, incident-disclosure policy), all previously dropped, plus the Frontier-more hardware/crypto items (on-device STT, ZK proofs, equipment-sharing negotiation, predictive maintenance, cross-node reputation, self-provisioning via vote) that were dropped entirely from the first pass.*

## v1.9 — Vertical integration of the supply chain

Restored as its own full increment — these are operations/business decisions more than software features, but several have a direct software dependency worth tracking, and the original list was cut roughly in half in the first pass.

1. Direct relationships with aggregate/material suppliers for bulk pricing instead of per-job ordering
2. An in-house material holding yard to smooth supply timing and cut per-load costs
3. Owning or leasing hauling capacity instead of renting per job — the OBD/vehicle-telemetry work already noted as a future upgrade in `docs/ROADMAP.md` plugs directly into this
4. Modeling the equipment-ownership-vs-rental breakeven point using the utilization data from the v1.5 analytics feature
5. Materials brokering at volume for smaller crews
6. Arranging direct disposal contracts instead of ad hoc runs, tracked via the existing documents module
7. In-house equipment maintenance/repair capability, feeding data back into the existing preventive-maintenance feature
8. Direct vendor API integration — this build's own docs already flag this as the explicit next step once volume justifies skipping the email-forward flow
9. A fuel/fleet card program once vehicle count grows, tied into the existing cost-tracking work
10. A private-label materials relationship, leveraging existing vendor accounts
11. Insurance/bonding brought in-house or pooled across multiple small operators as volume grows, distinct from the single-operator insurance discussion in Part 3
12. A financing arm — equipment leasing to smaller outfits, if a cooperative-credit or similar mechanism exists to underwrite it

*Reintegrated here: the in-house material yard, materials brokering, in-house disposal contracts, in-house repair capability, private-label materials relationship, pooled insurance/bonding, and the financing-arm item — 7 of 12 original items, all previously dropped, restoring this to the full original list.*

---

## Part 3: Adjacent business/legal/financial context

Not software work, and not versioned above, but part of the same planning conversation this doc was pulled from — expanded here with the actual mechanics and numbers rather than concept-only pointers, so nothing is lost even though it isn't FieldOps engineering scope. **None of this is legal, tax, or financial advice** — the point of writing it down is so it isn't lost between conversations, not to substitute for a CPA or lawyer.

### Government funding sequence

- **SR&ED** is available now as a sole proprietor, but only at the **15% non-refundable** rate against personal tax — the **35% refundable** rate needs a CCPC.
- **IRAP** requires incorporation and for-profit status — off the table until incorporated. IRAP and SR&ED can be stacked, but IRAP funding reduces the wage base SR&ED can claim against, and total government assistance can't exceed 75% of eligible project costs.
- **Timing difference matters**: SR&ED is retroactive, filed with the corporate tax return within roughly 18 months of fiscal year-end, and pays out months later. IRAP reimburses in real time against monthly/quarterly claims during the project itself, if a role is written into an IRAP contribution agreement.
- **The actionable item regardless of entity structure, starting now**: a dated project log — hypothesis, what was tried, what failed, what was learned — for this and related work. That log is what an SR&ED claim runs on later, and it's free to start today.

### Incorporation

- Ontario provincial incorporation fits a business operating mainly in Ontario — roughly $300 online through the Ontario Business Registry, a certificate usually issued within minutes. Federal incorporation ($200 through Corporations Canada) makes more sense for cross-Canada name protection, but still requires Ontario registration to actually operate here.
- A named company needs a NUANS name-search report (roughly $30–75); a numbered company skips it.
- Get a CPA's input on structure before filing — the tax math (salary vs. retained earnings, SR&ED eligibility) depends on the decision.

### Contracting with an existing client

- Invoicing can happen now as a sole proprietor. GST/HST registration is mandatory once revenue crosses $30K in a single calendar quarter (no grace period on that specific sale), optional before that — but voluntary registration lets input tax credits be claimed on business expenses and makes the invoice look like a real contractor relationship.
- **If payment needs to happen before incorporation completes**: a pre-incorporation contract naming *"[Proposed Name] Inc. (a corporation to be incorporated under the laws of Ontario), or its permitted assigns"*, with an assignment clause transferring the agreement to the corp once formed, is the standard legal mechanism — a promoter can bind a not-yet-existing corporation this way, and the corp can adopt the contract by conduct (invoicing under the corp name, depositing payment into the corp account). By default the signer is personally liable unless the contract expressly disclaims it. Given how fast Ontario incorporation actually is, the simpler path for most timing situations is just incorporating first and signing as the corp — it avoids the liability/adoption question entirely.
- **IP terms**: retain ownership of the underlying platform/codebase; license the deployed instance to the client. A standard work-for-hire that assigns all IP away blocks reselling or templating the system for a second client — directly relevant to the licensing direction in v1.5.
- **Payment structure**: a deposit + milestone + ongoing monthly hosting/support fee reads better long-term than a lump sum, matches the recurring-revenue model in v1.5, and gives a cleaner SR&ED-eligible labour trail.

### Salary, reinvestment, and the actual tax mechanism

- There's no personal "small business" tax bracket — the low CCPC rate (roughly 11.2–12.2% combined federal/Ontario on the first $500K of active income) belongs to the **corporation**, on retained income. Salary paid out is taxed on the personal return at normal graduated rates, plus CPP.
- **Salary vs. retained earnings is the real lever**: salary is a corporate expense (reduces taxable income) and is what becomes SR&ED-eligible labour cost, but it triggers CPP/EI/withholding remittances and personal tax. Retained earnings stay inside the corp at the lower rate, available for reinvestment.
- **Only salary generates RRSP room** (18% of prior year's earned income) — dividends generate none. A small, defensible salary (tied to real documented hours, since CRA checks reasonableness against actual work) that builds some RRSP/CPP room, with the rest left as retained earnings, is the common shape for a first year, not a maxed-out salary.
- **Real write-offs mostly come from corporate-direct spending**, not personal employee deductions against a T4 (which need a T2200 and get scrutinized hard for a sole director). Have the corporation buy and expense the laptop, hosting, equipment, and software subscriptions directly.
- **Only SR&ED-eligible labour is real T4 salary** — dividends, contractor invoices to yourself, shareholder loans, and bonuses don't qualify for the credit's proxy overhead treatment. There's also a documented per-owner salary cap and CRA scrutiny of owner-manager salary reasonableness — confirm current figures with an accountant rather than treating any cached number as current policy.
- **Personal spending is not a corporate deduction at any company size.** Personal groceries/lifestyle spending run through the corp gets reclassified by CRA on audit as a taxable shareholder benefit — added back to personal income, potentially with penalties, worse than just taking it as salary in the first place.
- **A concrete first-payment waterfall**, in order: (1) set aside any collected GST/HST in full, untouched — it was never income; (2) recoup already-spent setup costs (incorporation, NUANS, accountant setup, domain/hosting); (3) decide the salary-vs-retained split as above; (4) immediately hold back the CPP/EI/withholding portion of whatever salary is paid — due to CRA on a schedule, not spendable; (5) split what's left between an operating buffer and reinvestment.
- **A shareholder loan, not a straight equity purchase**, is the standard structure for personal money going into the corp (e.g. to fund equipment purchases) — a simple promissory note lets the corp repay that principal back later completely tax-free, since it's just returning capital, not a distribution. Confirm this with an accountant at incorporation time.

### Insurance

- Professional liability/E&O (roughly $800–1,800/yr), general liability ($500–1,200/yr), and cyber liability ($1,000–2,500/yr for under 50 employees, no card processing) are all genuinely relevant given this system handles a client's operational data. Bundled professional + general liability often runs $57–150/month combined. Realistic total: **roughly $2,000–4,000/year**, worth having before a second client, not after.

### Home office

- The clean structure is the corporation formally leasing a defined, documented portion of the home from the individual, who then reports that as personal rental income and deducts the proportional share of real home costs against it. This is paperwork-heavy for a small home office — worth asking an accountant whether it's worth the complexity yet, or whether letting salary simply cover personal rent/utilities (the simpler default) is the right call at this scale.

### A worked example of the "what does it take to hit a real goal by a real date" math

Kept here as a worked example rather than a specific commitment, since the actual numbers depend on real decisions (lease vs. buy equipment, actual target salary, actual home-office rent) that should be revisited with real figures when it matters:

- **Equipment financing has two real paths.** Buying outright (a 5-month sinking fund to pay off a roughly $9,400–$16,000 one-time buildout by a target date) front-loads cost but avoids ongoing lease payments. Leasing spreads the same buildout over time — and *which* lease matters: an FMV/operating lease has a lower monthly payment but no guaranteed ownership at term end (return, re-lease, or buy at whatever fair-market-value is assessed then); a **$1 buyout lease** (capital lease) costs more monthly but guarantees ownership at term end for a nominal $1, and is CCA-eligible since it's treated as an owned asset throughout. For equipment meant to be run for years, not cycled, the $1 buyout structure is the one that actually matches "I want to own this," even at the higher monthly cost.
- **A rough monthly fixed-cost stack**, illustrative: equipment lease (~$400–450/mo under a $1 buyout structure), insurance (~$300–350/mo), cloud/hosting (~$90/mo), home office rent (~$300–350/mo, if that structure is used) — roughly **$1,100–1,200/mo in fixed costs** before any salary.
- **Required monthly revenue** = (fixed costs + target salary) grossed up roughly 15–20% for tax/GST/operating reserve. At a $2,500/mo salary target on the lease-scenario fixed costs above, that lands around **$4,000–4,500/mo** in required revenue.
- **Translating that into client count** depends entirely on realistic pricing for a bespoke hosted system — comparable small-crew field-service platforms run roughly $275–650/month depending on tier and features. At a representative **$275/mo/client**, the math above needs on the order of **15–16 paying clients** to fully self-fund without any outside capital — a genuinely large jump from one client in under a year for a solo, part-time operator, which is exactly the gap IRAP and a real personal-investment buffer exist to close, so the client-revenue side only needs to cover salary + insurance + a smaller recurring cost base rather than the whole equipment buildout at once.
- **A personal-investment/shareholder-loan target**, if funding the equipment side directly rather than through client revenue: total monthly cash need × the number of months until the equipment is paid off, plus a safety margin for one slow month or a surprise expense — landed in the rough **$20,000–22,000** range in the specific worked scenario this was drawn from. Structure this as a shareholder loan (see above), not equity, and revisit the real numbers with an accountant once actual figures (real rent, real target salary, real lease quotes) exist.
- **A conservative advertising line**: $0–100/mo now, scaling to $150–300/mo only once real recurring revenue exists — consistent with v1.6's "paid marketing is revenue-gated" framing above.

### Session/tool notes worth keeping

- **Cross-session memory doesn't currently carry over in every tool context** — if working in an environment without automatic memory continuity, the practical move before starting a fresh session is to write current state (decisions made, blockers, file paths touched) into a `HANDOFF.md`-style file in the repo, then point the new session at that file plus the knowledge base. Migrate proactively before hitting a context/length limit, not reactively after.

### Explicitly out of this repo's scope

- **Multi-cloud portfolio work** (AWS/Azure/GCP/Cloudflare reference deploys, a parameterized Terraform/OpenTofu module, cert study for AWS SAA/Azure AZ-104/GCP ACE) is real and valuable as a separate career/portfolio track, but it's not FieldOps engineering — it doesn't belong in this repo's roadmap even though it was part of the same planning conversation.

*Reintegrated here: the full SR&ED/IRAP sequencing detail, the pre-incorporation contract mechanism, the full salary/RRSP/shareholder-loan structuring logic, the insurance cost breakdown, the home-office mechanism, and a worked version of the client-revenue/equipment-financing math with real numbers restored — all of which had been compressed down to single-line pointers in the first pass.*
