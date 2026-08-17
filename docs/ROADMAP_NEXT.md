# Roadmap: post-v1

v1 is done — see [CHANGELOG.md](../CHANGELOG.md) for what actually shipped and [SECURITY.md](SECURITY.md) for the current fixed/open list. This is the full backlog from a much larger cross-project planning history — several separate documents, not just one brainstorm — folded into nine incremental versions (1.1–1.9). There is no separate "v2" bucket: every feature that was ever discussed as v2 material lives inside v1.1–v1.9 below, or in Part 3 if it's genuinely not software work for this repo. This file was previously named `ROADMAP_V2.md`; renamed to drop that framing entirely.

Nothing here is committed to — this is a backlog to pick from, not a plan. Treat it the way `docs/ROADMAP.md`'s original phase list was treated before v1: a starting point that gets reordered by what actually hurts.

## Contents

- [State check: what's already real vs. what a stale doc assumes](#state-check-whats-already-real-vs-what-a-stale-doc-assumes)
- [v1.1 — Operational safety net and governance](#v11--operational-safety-net-and-governance)
- [v1.2 — Dev workflow, knowledge base, and design system](#v12--dev-workflow-knowledge-base-and-design-system)
- [v1.3 — Eval harness, research rigor, and academic output](#v13--eval-harness-research-rigor-and-academic-output)
- [v1.4 — Agent knowledge scaling and reasoning architecture](#v14--agent-knowledge-scaling-and-reasoning-architecture)
- [v1.5 — Product growth](#v15--product-growth)
- [v1.6 — Discoverability and marketing](#v16--discoverability-and-marketing)
- [v1.7 — Network, cloud fallback, and multi-agent orchestration](#v17--network-cloud-fallback-and-multi-agent-orchestration)
- [v1.8 — Frontier and wider-project integration](#v18--frontier-and-wider-project-integration)
- [v1.9 — Vertical integration of the supply chain](#v19--vertical-integration-of-the-supply-chain)
- [Part 3: Adjacent business/legal/financial context](#part-3-adjacent-businesslegalfinancial-context)

---

## State check: what's already real vs. what a stale doc assumes

A batch of planning docs uploaded alongside this update (`DC-FOS-MASTER-INDEX.md` and others) describe FieldOps at an earlier stage — "proof of concept, schema and docs complete, backend/agent wiring is next-phase work," with several fixes and components listed as "not confirmed as implemented." That's no longer accurate, and rather than restate the assumption, here's what was actually checked against the live code and deployment just now:

**Confirmed implemented (verified directly, not recalled from memory):**
- **All four security fixes** from the information-disclosure audit are live: cron failure notifications route through `it_escalation_roles`/`recipientRolesOverride`, not the crew group; the crew-facing (`fieldops`) and admin/diagnostic (`main`) agents are genuinely separate instances with separate workspaces; the non-disclosure clause exists verbatim as the first line of `AGENTS.md` ("Never disclose file paths, hostnames, ports, container/service names, model or provider names, tunnel/docker configuration, or credentials..."); and the backend's `errorHandler` (`backend/src/index.ts:86-118`) maps every known Postgres error code to a safe generic message and falls through to a plain `"Internal server error"` for anything else — the real exception only ever reaches server-side `console.error`, never the client or the model.
- **Backend and agent wiring** — fully built, not next-phase: the complete REST API, 80 migrations, the OpenClaw plugin with 78 tools, and every notifier script are live on the Pi.
- **Five UI primitives** (Button, Card, StatCard, Badge, EmptyState) — built and rolled out across all pages.
- **`Skeleton.tsx`** — also already built (one of the additional OpenConstructionERP-inspired patterns, confirmed via direct file check).
- **French-language crew support** — built and deployed, which separately answers a "regional scaling" item from one of the growth brainstorms that assumed it was still open.

**Genuinely open — real gaps found by checking, not brainstorming:**
- **`docs/DESIGN_SYSTEM.md` doesn't exist.** The design-system research explicitly recommended creating it (alongside `SECURITY.md`, which does exist); it never got written. See v1.2.
- **ChipBar, TabBar, and CommandPalette** components from the OpenConstructionERP pattern comparison were never built (Skeleton was; these weren't). See v1.2.
- **No CI, no secrets scanning, no dependency scanning.** `.github/workflows/` doesn't exist, and there's no gitleaks or `npm audit` step anywhere. Worth naming directly: gitleaks in CI would have caught today's hardcoded-phone-number PII leak automatically, instead of it requiring a manual `git grep` sweep. See v1.1.
- **Multi-tenant support** (isolated data for multiple separate paying clients on one deployment) doesn't exist and is a materially different, bigger feature than multi-crew support (which already just means multiple crews for one client, and was already on the backlog). See v1.5.
- **No standing cloud-fallback infrastructure at all** — not a VM, not a failover runbook, not a drill. This was scoped in two of the uploaded docs as real near-term infrastructure work, not speculative. See v1.7.
- **A real, documented scope-drift risk**: newer planning docs propose direct vendor API ordering, reusing vehicle-telemetry hardware for truck/hauling dispatch, and (further out) RFID/backscatter tagging — all three of which `docs/ROADMAP.md`'s own "Explicitly out of scope for the POC" section already named as deliberate cuts. None of the three have been consciously re-opened; they're at risk of drifting past instead. Flagged explicitly in v1.9.

## v1.1 — Operational safety net and governance

The cheapest, most proven-value increment — grounded directly in two real incidents from 2026-08-17 (a foreign-key ordering bug that crashed a test scenario and left production residue, and a WhatsApp group-membership issue that took a long manual SSH/SQLite excavation to root-cause), plus the concrete security/ops gaps confirmed in the state check above.

- **CI.** A GitHub Actions workflow running the deterministic checks (`tsc --noEmit`, both plugins' vitest suites, `plugins validate`) on every push/PR is the single highest-value, lowest-cost item on this whole list. The live-LLM agent-tests suite costs real money per run — keep that on the existing 12-hour schedule, not on every push.
- **Secrets scanning (gitleaks) on every push**, and **dependency scanning (`npm audit`/`pip-audit`) on a schedule.** Confirmed absent — this would have caught today's hardcoded phone-number leak automatically.
- **Tracing on the message→tool-call→response path**, and **structured logging of every agent tool call specifically**, not just the chat transcript — a sharper version of "centralized logs," since debugging today's incidents meant reconstructing tool-call sequences by hand from raw session JSON.
- **Centralized logs.** A lightweight Loki/Grafana setup (or Wazuh, if the anomaly-review angle matters more than log search) on the Pi itself, no new hardware, collapsing the systemd journal / openclaw sqlite / per-session files / Docker logs into one place.
- **A blameless postmortem template**, with **named severity levels (SEV1–3)** so "the bot leaked infra info" and "a typo in a reply" aren't handled with the same urgency.
- **A written backup/retention policy with a quarterly restore test** — and treat that restore test as a disaster-recovery pentest too: does the restored system leak old credentials or stale tokens along with the data?
- **A quarterly self-pentest** — actively try to leak infra info from the crew-facing agent, the same way the original leak was actually found. Extends the one-time fix into an ongoing practice.
- **A formal vulnerability-disclosure note** in the docs, even solo — write down what a real pentester should check.
- **Treat the Cloudflare Tunnel config itself as attack surface** — review exposed routes quarterly.
- **A lightweight SOC triage simulation**, even as a solo operator: alert → auto-triage → escalate → human. The `it_escalation_roles` mechanism already does a version of the last step.
- **Runbook-as-code**, a formal on-call rotation once not the sole responder, a 5-minute change-advisory checklist before deploys, a written **PIPEDA data-retention policy** (a real compliance gap — this system already stores real personal data), and a quarterly access review of who/what holds admin-agent permissions, service tokens, and SSH keys.
- **Defined SLOs**, a written escalation path, and formalized **cost/token budget tracking per model** — `model_usage_daily` already gives this a head start.

## v1.2 — Dev workflow, knowledge base, and design system

Near-zero cost, and compounds the longer it's delayed. This is "how the system gets worked on and documented," not a feature for crew or management.

- **A task/work board** (GitHub Projects, or Linear if the overhead is worth it) scoped to *dev work on the system* — not day-to-day crew ops, which the WhatsApp bot already handles.
- **A git-backed knowledge base** (Obsidian or equivalent), foldered by function (`architecture/`, `runbooks/`, `vendors/`, `incidents/`) rather than by date.
- **Write `docs/DESIGN_SYSTEM.md`.** Confirmed missing. Capture what already exists (the token layer, the 5 primitives, the OpenConstructionERP comparison and its licensing note — re-implement patterns, never copy AGPL-3.0 code directly) plus the specific patterns identified but not yet built: **ChipBar, TabBar, and CommandPalette** components, the **map-as-card** layout pattern, a **responsive grid that was initially mistaken for a carousel** (worth re-examining that assumption before building around it), and an **onboarding-checklist pattern** for first-time crew users.
- **A `SYSTEM-STATUS.md`-style page**, updated by cron, showing last backup, last deploy, agent uptime — most of the underlying data already exists (`backup_status`, `dashboard_url`, `model_usage_daily`). Also serves as the single file a fresh AI session should be pointed at first, rather than re-deriving state from scratch.
- **Automated changelog/release-notes generation tied to the repo** — `CHANGELOG.md` exists but is hand-maintained; a generator would reduce the chance of it drifting from reality the way the uploaded planning docs already have.
- **Every prompt/config change dated and reasoned in git**, mirrored to a knowledge-base changelog entry.
- **RBAC formalization (Casbin/OPA)** and **IaC (Ansible/Terraform) for redeploy**, both deferred until there's an actual trigger (a more complex role matrix, or a second environment/real DR need).

## v1.3 — Eval harness, research rigor, and academic output

Builds on the existing `agent-tests` suite (14 scenarios, no `--deliver`), and extends into treating the build as a legitimate research/portfolio artifact.

- Ablation tests, a weekly human-scored transcript sample, monthly reruns, a fault-tree split on failures (retrieval miss vs. model error vs. stale doc), A/B prompt testing, and a reproducibility packet (pinned model/prompt versions + a knowledge-base snapshot hash per run).
- Prompting grounded in published patterns (ReAct, self-consistency) over ad hoc tweaking, and a formal taxonomy of failure modes specific to trade-terminology parsing.
- **A named write-up suite**, since these were explicitly proposed but never drafted:
  - A capstone-style writeup mapping the system's real networking/deployment decisions to course material
  - A formal write-up of any Boolean/logic design used in agent routing rules, if relevant coursework calls for it
  - **FieldOps Eval Harness** — methodology, rubric, sample results (draftable now, real data exists)
  - **Security Hardening Postmortem** — the actual infra-leak incident this build fixed: root cause, fix, verification. Also draftable now, with the state-check above as source material.
  - **DeepSeek vs. Claude fallback** — a comparative performance log, using real `model_usage_daily` data
  - A designed-vs-executed gap analysis for the agent stack specifically, in the same honest-audit spirit as the state check above
  - A narrative case study tying the practical build to whatever larger thesis it feeds into
- **SR&ED log discipline**: separate "engineering as usual" from genuine technological-uncertainty work — only the latter qualifies — and track hours against specific project codes from day one, since that's what makes a claim easy to assemble later rather than reconstructed after the fact.

## v1.4 — Agent knowledge scaling and reasoning architecture

AGENTS.md keeps growing every time a feature ships — it's the sole source of policy/behavior context today, and that doesn't scale indefinitely. This increment is about the point where it does become unwieldy, not before.

- Plain vector RAG (pgvector) over the v1.2 knowledge base, scoped and read-only per the crew agent's existing least-privilege boundary — explicitly not GraphRAG for this system (see v1.8 for where GraphRAG actually belongs).
- Citation-style source tracing, a controlled vocabulary for entities, confidence scores with auto-escalation on low-confidence answers.
- Route by task complexity (cheap model for lookups, stronger fallback for reasoning — already roughly the shape of the existing 5-provider chain, made explicit and RAG-aware); retrieval-augmented tool selection; speculative pre-fetching of likely next tool calls during a multi-step exception flow; a nightly memory-consolidation job summarizing the day's WhatsApp threads into knowledge-base entries, human-reviewed before merge — the natural companion to `export-nightly-transcripts.mjs`, which already produces the raw material.
- Supporting infrastructure: versioned embeddings alongside knowledge-base commits, periodic drift checks, auto-extracted entity proposals, JSON-schema-constrained tool calls, synthetic stress-test messages (including non-English phrasing, sarcasm, and tone variation via synthetic personas), a separate episodic/semantic memory split once plain RAG isn't enough, and short structured interviews with crew on when they trust vs. override the agent.
- **Sequencing note**: a planning doc anchored this specific track to a real calendar — prototype one role-based agent squad this term, fold Docker segmentation into relevant coursework, sandbox tooling and a first honest audit of the agent stack in the following term, a GraphRAG pilot the term after that. Worth keeping that calendar anchoring alive somewhere even though this file orders by dependency rather than date — see v1.7 and v1.8 for where the segmentation and GraphRAG pieces actually live.

## v1.5 — Product growth

Follows demand, not the other way around — build these once there's an actual second client or a concrete ask, not preemptively.

- A read-only client-facing portal; **multi-crew support** — multiple crews under one dispatcher for the *same* client, schema-compatible with what's already built.
- **Multi-tenant support** — a materially different, bigger item: isolated data for *multiple separate paying clients* on one deployment. Confirmed not built. This has real security-architecture implications (tenant isolation, not just role scoping) and should be scoped deliberately once there's a real second client, not bolted on reactively — see v1.7 for the network-isolation angle.
- Seasonal diversification (snow removal) on the same crew/equipment/`job_types` core; equipment utilization analytics; automated post-job review requests; recurring maintenance contracts; data-driven flagging of clients with recurring property issues.
- **New service-line ideas, bigger in scope than a v1.x tweak, worth naming even if not near-term**: an irrigation-as-a-service product on future smart-home-tier hardware (WhatsApp control, weather-based auto-skip, leak/burst auto-shutoff); a "guerrilla crew-assembly" layer extending the existing crew/scheduling module for ad hoc broadcast-and-first-confirm dispatch (with a hard compliance gate — worker-classification and clearance verification per dispatch — required before any production use); and extended dispatch for trucks/haul/vendors/independent contractors reusing the same broadcast model. None of these are scoped in detail yet; they're named here so they don't get silently reinvented later.
- **Licensing/franchise direction**, enriched: package the ops model (not just the software) for a second crew, and consider the MSP-layer reuse angle specifically — the same monitoring/backup/logging stack this system already needs for itself (v1.1) becomes a sellable tiered-retainer product for other small trade businesses, with shared RMM, managed backup/firewall, and simple ticketing.
- A standardized onboarding checklist so a second client doesn't require personal hand-holding every time.
- Crew retention as a designed lever (fair, transparent hours/performance visibility), and a grant/pilot funding angle worth tracking alongside growth — see Part 3.
- **Explicit sequencing guardrail**: don't pursue v1.9 (vertical integration) ahead of this section — several v1.9 items require capital and volume that don't exist yet, and committing to them before a real client base exists means funding against demand that isn't there. Revisit v1.9's priority once growth here is actually real.

## v1.6 — Discoverability and marketing

Organic tactics are low/no-cost and can start any time; paid tactics are gated on real recurring revenue existing first, not funded from the equipment/reinvestment budget.

### Organic

**Professional register**: a LinkedIn presence and case-study page; a referral ask to the existing client; Google Business Profile; a QR-coded business card; cold outreach using the case study; Chamber of Commerce membership; a trade-show table; a client testimonial video; direct mail to a short target list; a sponsored mention in a trade newsletter; and a direct "the system that fixed \[client\]'s chaos" pitch framing to local trade associations — the origin story is genuinely a good hook, not generic SaaS pitch copy.

**Academic register**: present the case study at a relevant student competition and capstone showcase; a guest demo for a relevant course; a features-spotlight pitch to the school's applied-research office; a short writeup for a student research journal; thought-leadership posts drawn from the lab writeups; a demo-day presentation; co-writing a note with a professor; an academic-partnership announcement; an alumni newsletter pitch.

**Frontier register**: `llms.txt` + Person/Organization schema; short demo videos of the agent handling real (anonymized) interactions; open-sourcing a non-sensitive component with a strong README; a "build in public" thread tied to real milestones, not a content calendar; a shareable short-form video hook; a founder newsletter; podcast guest spots; a local tech meetup demo; cross-posting to genuinely relevant niche communities; submitting to OpenClaw/agent-tooling showcases.

**Cooperative/community register**, if that framing becomes part of the pitch: a landing page on the sovereignty/cooperative philosophy as real differentiation; explicit "powered by" branding; diaspora outreach if relevant; honest public progress updates; presence at a co-op development event; a one-page manifesto; repurposing the case study directly into grant materials; timing milestone announcements to real technical proof points.

**Discoverability specifics** (tightened from the general `llms.txt`/schema item above): confirm `robots.txt` doesn't block AI crawler/answer-bot variants specifically (GPTBot, ClaudeBot, PerplexityBot, and their search-specific variants — training bots and answer bots are different and both matter); make sure key pages are server-rendered or pre-rendered, since JS-only content is often invisible to crawlers; lead each page with a clear answer/definition before the detail, since that's what gets quoted; and periodically self-test by literally asking Claude/ChatGPT/Perplexity what surfaces when asked about the work, adjusting based on what's missing.

### Paid (revenue-gated, not before)

Geo-targeted local ads and retargeting once a case study exists; LinkedIn/community-specific placement matched to whichever register above is actually the audience for the next few clients; a Show HN post and Product Hunt launch tied to a real milestone (algorithmic, not paid, but frontier-native distribution regardless).

## v1.7 — Network, cloud fallback, and multi-agent orchestration

Deferred until there's an actual bottleneck of the specific shape each item solves — the two-party-pilot pattern and message-draft queue have kept a single agent workable through all of v1; don't split it preemptively. Cloud fallback is the one exception in this tier that two separate planning docs treated as near-term, not speculative — called out explicitly below.

- **Cloud fallback — confirmed not built at all**, and worth treating as real infrastructure work rather than deferred aspiration: a standby cloud VM (Hetzner/DigitalOcean-class, powered off until needed), nightly `pg_dump` + config sync extended to it, Cloudflare Tunnel configured with dual origins and DNS failover on health-check failure, a health-check script that can auto-trigger the cloud VM's boot via API on repeated local failure, the WhatsApp webhook target switchable via one config value, a read-only "degraded mode" agent on the cloud VM that answers from the last-synced snapshot and defers writes until the Pi returns, a UPS on the Pi to absorb brief power blips before failover triggers unnecessarily, Redis-based message-queue separation so in-flight messages survive a crash, a documented manual failover runbook, a quarterly failover drill (kill the Pi on purpose, time the recovery), and a post-recovery reconciliation job merging anything the cloud handled back into the Pi's source of truth.
- **Multi-agent orchestration** — a dispatcher/inventory/exception-escalator split via LangGraph or CrewAI (open-source, not Enterprise), only once the single `fieldops` agent's prompt and tool count (78 and growing) actually become unwieldy. n8n, Langflow, or Flowise as a prototyping sandbox, kept out of production. Treat SaaS orchestration control planes (Copilot Studio, CrewAI Enterprise, watsonx Orchestrate) as reference architecture, not infra to adopt.
- **An AutoGen-style agent-to-agent pattern** — a concrete use case: an admin/diagnostic agent talking to a monitoring agent before escalating to a human.
- **Resilience primitives**: a circuit breaker between the notifier scripts and WhatsApp delivery (today's incident ran the standard 3-retry escalation regardless of whether the cause was transient or structural); Redis-backed message buffering across a host reboot; rate-limiting crew-facing calls; mTLS between internal services once there's more than one node to secure; **hard network segmentation specifically** — the crew agent and any future admin/diagnostic agent (and, later, separate tenants under multi-tenant support in v1.5) on separate Docker networks, not just separated by prompt convention; an admin-only health-check dashboard, never public; chaos-testing the tunnel intentionally against the existing `dashboard_unreachable`/`connectivity_degraded` alerts; self-healing Docker health checks with structured incident logging feeding the v1.1 postmortem trail.
- **DID-addressable agent identity**, a mesh-aligned edge/regional/hub topology, and a federated agent network across future deployments — all realistically post-graduation-timeframe items, named here so they're not lost, not scheduled.
- **A workflow-scheduler reference model** (studying how something like Orkes Conductor handles distributed task scheduling) as design input for a future multi-node system, without adopting the SaaS product.

## v1.8 — Frontier and wider-project integration

The furthest-out tier — genuinely speculative, and most of it isn't for the crew-facing bot. Named early because naming a frontier idea is cheap, not because any of it competes for near-term time. One of the source docs was explicit about this discipline: these stay **design-only**, and none of them compete with higher-priority work for time or budget — worth carrying that framing forward rather than letting "frontier" quietly mean "someday, maybe."

- GraphRAG and hybrid retrieval, scoped to a structured cross-project registry if one develops — the correct home for GraphRAG, never the crew bot.
- Research-grade agent behavior: a self-reflective pass critiquing its own draft against sources before sending, a planner/executor split, a local small-model fallback for offline mode, a shadow-deployment mode for testing a new prompt/model version silently before cutover.
- Federated agent memory across multiple deployments, if more than one ever exists; formal testable non-disclosure constraints (a stronger, independently-enforced version of the existing prompt-based rule); the agent proposing new SOP entries when it spots a repeated unresolved pattern, for human approval; agent-to-agent negotiation prototypes, if a broader governance/voting layer exists to negotiate within; cryptographically attributed agent actions via a DID/verifiable-credential stack, if one exists at a broader project level; graph-of-thought reasoning once there's an actual graph worth reasoning over; live IoT/sensor fusion once real field telemetry hardware exists beyond WhatsApp location; field-level redaction in a future graph, a stronger version of the existing role-scoped retrieval boundary; agent-authored test cases closing the loop with the v1.3 eval harness.
- **Wider-project integration**, if this deployment is ever used as a reference implementation for something larger: a registry doc for formal agent roles/permissions/identities; an explicit sovereignty/cost-tradeoff writeup of the self-hosted-vs-SaaS decisions already made here (no direct vendor ordering, Cloudflare Tunnel over port-forwarding, DeepSeek-primary fallback), measured against whatever the broader project's own principles are rather than just described as a config choice; MCP as a standard integration surface instead of bespoke per-tool wiring; a forkable starter-kit template; a capability-tiers doc tying agent trust levels to a reputation system, if one exists; rolling agent cost accounting into a shared ledger if one exists, so usage is a shared line item rather than a personal bill; cross-referencing this build's governance rules with any broader project-level governance doc; an agent incident-disclosure policy consistent with whatever transparency principles the broader project holds itself to.
- **Speculative hardware/crypto items**, listed for completeness: on-device speech-to-text for offline voice check-ins; zero-knowledge proofs so crew location/hours can be verified without exposing raw GPS; agent-negotiated equipment-sharing between job sites; predictive-maintenance agents fed by real equipment telemetry once that hardware exists; cross-deployment agent reputation scoring; self-provisioning agents that request new tool access via a formal vote rather than a manual grant.

## v1.9 — Vertical integration of the supply chain

Operations/business decisions more than software features, but several have a direct software dependency worth tracking. **Gated behind v1.5** per the explicit sequencing guardrail there — don't commit capital here against demand that doesn't exist yet.

1. Direct relationships with aggregate/material suppliers for bulk pricing instead of per-job ordering
2. An in-house material holding yard to smooth supply timing and cut per-load costs
3. Owning or leasing hauling capacity instead of renting per job — the OBD/vehicle-telemetry work already noted as a future upgrade in `docs/ROADMAP.md` plugs directly into this
4. Modeling the equipment-ownership-vs-rental breakeven point using the utilization data from the v1.5 analytics feature
5. Materials brokering at volume for smaller crews
6. Arranging direct disposal contracts instead of ad hoc runs, tracked via the existing documents module
7. In-house equipment maintenance/repair capability, feeding data back into the existing preventive-maintenance feature
8. Direct vendor API integration
9. A fuel/fleet card program once vehicle count grows, tied into the existing cost-tracking work
10. A private-label materials relationship, leveraging existing vendor accounts
11. Insurance/bonding brought in-house or pooled across multiple small operators as volume grows, distinct from the single-operator insurance discussion in Part 3
12. A financing arm — equipment leasing to smaller outfits, if a cooperative-credit or similar mechanism exists to underwrite it

**A real, standing governance flag, not a hypothetical one**: item 8 above, plus reusing vehicle-telemetry hardware for truck/hauling dispatch (item 3), plus any future equipment/loadout tracking that wants RFID/backscatter at larger scale, all reopen decisions that `docs/ROADMAP.md`'s own "Explicitly out of scope for the POC" section already names as deliberate cuts (no direct vendor API ordering, no OBD hardware for the POC, no RFID/backscatter tagging). None of the three have been consciously re-opened yet by an actual decision — they're just present in newer planning material as if the original scope cut didn't happen. Re-confirm each one explicitly, in writing, before building it. Silent drift past a documented scope decision is exactly the kind of thing this roadmap file exists to prevent.

---

## Part 3: Adjacent business/legal/financial context

Not software work, and not versioned above, but part of the same planning history this doc draws from — kept here, expanded, so nothing is lost even though it isn't FieldOps engineering scope. **None of this is legal, tax, or financial advice.**

### Government funding sequence

SR&ED is available now as a sole proprietor (15% non-refundable against personal tax); the 35% refundable rate needs a CCPC. IRAP requires incorporation and for-profit status, and reimburses in real time against monthly/quarterly claims rather than retroactively like SR&ED. They can be stacked, but IRAP funding reduces the SR&ED wage base, and combined assistance can't exceed 75% of eligible project costs. The actionable item now, regardless of entity structure: a dated project log (hypothesis, what was tried, what failed, what was learned), separating genuine technological-uncertainty work from ordinary engineering, with hours tracked against project codes from day one.

### Incorporation, contracting, and IP terms

Ontario provincial incorporation (~$300, minutes online) fits a business operating mainly in Ontario; get a CPA's input on structure first, since the salary-vs-retained-earnings math depends on it. Invoicing can happen now as a sole proprietor; GST/HST registration is mandatory past $30K in a single quarter, optional before that. If payment needs to happen before incorporation completes, a pre-incorporation contract naming "[Proposed Name] Inc., or its permitted assigns" with an assignment clause is the standard mechanism, though incorporating first and signing as the corp is simpler where timing allows. Any client contract should retain ownership of the underlying platform/codebase and license only the deployed instance — a standard work-for-hire that assigns all IP away blocks the licensing direction in v1.5. A deposit + milestone + ongoing monthly fee structure matches the recurring-revenue model already in v1.5 and gives a cleaner SR&ED labour trail than a lump sum.

### Salary, reinvestment, and tax mechanics

The low CCPC rate (~11.2–12.2% combined) belongs to the corporation on retained income, not to a personal "small business bracket." Salary is a corporate expense and the SR&ED labour-cost basis, but triggers CPP/EI/withholding and personal tax; only salary generates RRSP room (18% of prior year's earned income). A modest, defensible salary tied to real documented hours, with the rest retained in the corp, is the usual first-year shape — not a maxed-out salary. Real deductions mostly come from the corporation buying and expensing things directly (laptop, hosting, equipment) rather than personal employee write-offs, which need a T2200 and get scrutinized hard for a sole director. Only real T4 salary counts as SR&ED-eligible labour — not dividends, contractor invoices to yourself, shareholder loans, or bonuses — and there's a documented per-owner salary cap plus CRA scrutiny of reasonableness, worth confirming current figures with an accountant rather than trusting a cached number. Personal spending run through the corp is not a deduction at any size — CRA reclassifies it as a taxable shareholder benefit on audit. Personal money going into the corp (e.g. to fund equipment) is cleanest as a shareholder loan via a simple promissory note, not an equity purchase, since a loan can be repaid back out tax-free later.

A concrete first-payment waterfall: set aside any collected GST/HST in full, untouched; recoup already-spent setup costs; decide the salary/retained split; immediately hold back the CPP/EI/withholding portion of whatever salary is paid; split what's left between an operating buffer and reinvestment.

### Insurance and home office

Professional liability/E&O (~$800–1,800/yr), general liability (~$500–1,200/yr), and cyber liability (~$1,000–2,500/yr) are all genuinely relevant given this system handles a client's operational data — roughly $2,000–4,000/year total, worth having before a second client. A formal corp-leases-from-owner home-office structure is real but paperwork-heavy for a small office; letting salary simply cover personal rent/utilities is the simpler default at this scale.

### A worked example of the equipment-financing/client-revenue math

Kept as an illustration, not a commitment — real numbers (actual lease quotes, actual target salary, actual home-office rent) should replace these when it matters. Equipment financing has two real paths: buying outright front-loads a roughly $9,400–16,000 one-time cost against a sinking fund; leasing spreads it out, and the lease *type* matters — an FMV/operating lease has a lower payment but no guaranteed ownership at term end, while a **$1 buyout (capital) lease** costs more monthly but guarantees ownership and is CCA-eligible throughout, the better fit for equipment meant to run for years rather than cycle. A rough monthly fixed-cost stack under a lease structure (equipment, insurance, hosting, home office) lands around $1,100–1,200/mo before salary; grossing up a $2,500/mo salary target against that for tax/GST/reserve puts required monthly revenue around $4,000–4,500. At a representative $275/mo/client for a bespoke hosted system, that's on the order of 15–16 paying clients to fully self-fund without outside capital — a genuinely large jump from one client for a solo, part-time operator, which is exactly the gap outside funding (IRAP, a personal shareholder-loan buffer) exists to close so client revenue only has to cover salary and a smaller recurring base, not the whole buildout at once. A specific worked personal-investment target in this scenario landed around $20,000–22,000 including a safety margin, structured as a shareholder loan. Advertising stays conservative — $0–100/mo now, scaling only once real recurring revenue exists, consistent with v1.6.

### Hardware/infrastructure procurement for the broader project

Not FieldOps scope at all — a separate set of planning docs cover a right-sized central server (~$1,500–2,500), Cisco Modeling Labs licensing (~$470/yr), a Pi fleet for other sub-projects, homelab networking gear, and a multi-cloud portfolio lab series (see below), totaling roughly $6,700–11,200 one-time plus recurring cloud/licensing costs, sequenced in tiers from "fund immediately" through "defer until SR&ED/IRAP cash actually lands." Noted here only as a pointer, since it's real money planning that touches the same person and the same SR&ED log, but it isn't this repo's roadmap.

### Multi-cloud portfolio work

A parallel, opportunistic career/portfolio track — not production infrastructure, and not FieldOps engineering, even though it reuses this system's architecture as the reference stack. The scope, if pursued: the same API+Postgres+storage+cron+monitoring architecture deployed identically on AWS, Azure, GCP, and Cloudflare (plus Oracle Cloud for its free tier), unified by one parameterized Terraform/OpenTofu module and a GitHub Actions matrix build, with a genuine chaos/failover drill and a cost-per-workload comparison as the actual skill-signaling deliverables — not four separate manual deploys. A six-lab series (AWS, Azure, GCP, Cloudflare edge-native rebuild, the multi-cloud Terraform module, the chaos drill) with the same stop-condition discipline as any other lab series: all four pass the same eval harness already built for this system. Doubles as direct study material for the standard entry-level cloud certs. Budgeted small (~$50–100/mo during active work, mostly covered by free tiers) and explicitly scheduled around coursework, not competing with this repo's own priorities.

### AI session/tooling practices

Worth keeping regardless of which AI tool is in use, since cross-session memory doesn't reliably carry over in every context:
- Keep one `STATE.md`/`SYSTEM-STATUS.md`-style file as the single thing a fresh session should be pointed at first (already planned in v1.2) rather than re-deriving context verbally each time
- Split system prompts/session scopes explicitly: a locked-down context for anything crew-facing or production-adjacent, a full-context one for admin/dev work — the same split already applied to the live agents (see the state check above)
- Write a handoff summary *before* being forced to by a length limit, as a dated file (e.g. `handoffs/2026-08-16.md`), not just pasted chat text — short and decision-focused, skipping the exploratory back-and-forth
- Cut over to a new session early if one is looping or stuck, noting why in the handoff, rather than waiting for a hard lockout
- Re-upload files that matter rather than assuming they carried over; do a quick sanity check by asking a fresh session to restate its understanding before proceeding
- Keep genuinely separate workstreams in separate sessions from the start
- Log session transitions in `SYSTEM-STATUS.md` for a real timeline of when/why context resets happened, and periodically prune old resolved handoffs so they don't keep riding along
- Keep task scope narrow per session — one feature, one fix — so context doesn't have to stretch across unrelated work
