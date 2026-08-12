# openclaw/

OpenClaw gateway configuration and agent tool plugins.

OpenClaw is a CLI tool (`curl -fsSL https://openclaw.ai/install.sh | bash`), not a Docker service — it runs as a native systemd user service on the host. See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) for the real install/run steps. `docker-compose.yml` only manages Postgres and the backend.

- `openclaw.config.example.json` — reference config, verified against a real running OpenClaw 2026.7.1-2 instance (`openclaw config schema` / `openclaw config get`), not just docs. Set `tools.profile` to `messaging`, not the `coding` default — this agent talks to crew over WhatsApp, it shouldn't have shell/file/coding tools. Don't hand-edit API keys into a config file; use `openclaw onboard --deepseek-api-key <key> ...` or `openclaw config set` so credentials go through OpenClaw's own secret handling.
- `plugins/fieldops-tools/` — the agent tool plugin mapping the backend API ([../docs/API.md](../docs/API.md)) to callable tools, built with OpenClaw's `defineToolPlugin` SDK (`openclaw plugins init --type tool`). **44 tools across every API.md group**: Assets & Inventory (8), Loadouts & Checkout (6), Orders & Transfers (6), Vendors & Purchase Orders (4), Crew Members (2), Sites (3), Scheduling & Check-in (6, including `assign_shifts_batch`), Alerts (2), Vehicles & Location (4), Documents (3). Built, `npm run plugin:build && npm run plugin:validate` passing, installed with `openclaw plugins install ./plugins/fieldops-tools --link`, and every tool smoke-tested end to end against the real backend — including every business-rule guard (forward-only order/transfer status, illegal timeclock transitions, wrong-site transfer rejection, PO send/fulfill state machine, damaged-checkout routing to in_maintenance).
- `plugins/fieldops-media/` — hook-only plugin (no agent tools) that auto-logs inbound WhatsApp photo attachments as documents, bypassing the agent turn entirely. Uses `definePluginEntry` + `api.registerHook("message:received", ...)` rather than `defineToolPlugin`, since tool plugins have no hook-registration surface. Resolves the sender's phone to a crew member via `GET /crew-members?phone=`, uploads the already-downloaded local file via `POST /documents/upload`, tagged `auto-logged`/`whatsapp`. Built, unit-tested (`npm test`), installed (`openclaw plugins install`), and smoke-tested end to end by invoking the real `register()`/hook handler against the live backend — confirmed byte-identical file round-trip, correct skip behavior for unmatched senders, and correct no-op for non-image media (voice notes).
- `agent-workspace/` — the system prompt, as OpenClaw actually structures it: not a single string, but a workspace of instruction files (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`). **Done.** Deployed to a dedicated **isolated agent** (`openclaw agents add fieldops`, its own workspace at `~/.openclaw/agents/fieldops/workspace` on the Pi) rather than overwriting the default `main` agent — `main` is OpenClaw's generic personal-assistant template (a companion with a name/vibe/emoji, "wake up and figure out who you are" onboarding, heartbeat/group-chat conventions); none of that fits a business dispatch tool, so `fieldops` gets entirely rewritten content instead. Covers: the confirm-before-execute rule from [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) (with the exact tool list it applies to), the business rules each tool enforces (so the agent doesn't fight the backend), the real crew vocabulary from [../docs/GLOSSARY.md](../docs/GLOSSARY.md), and an explicit list of what's NOT built yet so the agent doesn't imply capabilities it doesn't have.
- WhatsApp channel — **paired and bound.** The `whatsapp` plugin isn't bundled by default; installed via `openclaw plugins install @openclaw/whatsapp`, then `openclaw channels login --channel whatsapp` for the QR pairing (needs a phone present — not scriptable). Explicitly bound to the `fieldops` agent with `openclaw agents bind --agent fieldops --bind whatsapp`, confirmed via `openclaw agents bindings` (`fieldops <- whatsapp`) — without this, WhatsApp traffic would route to the personal `main` agent by default, not `fieldops`.
- Model provider — **chain configured, no keys added yet.** A 5-provider fallback chain, cheapest to most expensive: DeepSeek → Kimi (Moonshot) → OpenAI → Gemini → Claude (see [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#model-provider) for why). Scoped to the `fieldops` agent specifically via `openclaw config patch` against `agents.list` — `openclaw models set`/`fallbacks add` don't support `--agent`, they only touch global defaults, so a direct config patch was the only way to leave the personal `main` agent's model settings untouched. Confirmed via `openclaw models status --agent fieldops` (chain shown, all 5 correctly listed under "Missing auth") and `--agent main` (unaffected). Proven end-to-end with a real WhatsApp message: it arrived, passed the allowlist, routed to `fieldops`, attempted the model call, and failed cleanly with `ProviderAuthError: No API key` — every layer except the key itself is confirmed working. Adding real keys is the last step before a real reply. **New finding (2026-08-12):** a manual cron trigger showed `deepseek/deepseek-chat` and `moonshot/kimi-k2.6` failing with `model_not_found` rather than a missing-auth error like openai/google/claude — worth checking the exact model id strings against `openclaw models list --provider deepseek`/`moonshot` once keys are added, in case the configured ids are stale.

## Status digests

Three `openclaw cron` jobs (not the per-agent heartbeat mechanism — see [agent-workspace/HEARTBEAT.md](agent-workspace/HEARTBEAT.md) for why) send a WhatsApp status summary at fixed times daily, DM'd to the owner's own number for the demo. Each triggers a normal `fieldops` agent turn that calls existing `fieldops-tools` tools (no new backend endpoint) and delivers the final reply via `--announce`:

| Job | Time | Prompt calls |
|---|---|---|
| `fieldops-digest-morning` | 6:00 AM America/Toronto | `list_shifts` (today), `list_alerts` (resolved=false) |
| `fieldops-digest-midday` | 12:00 PM America/Toronto | `get_crew_status`, `list_alerts` (resolved=false) |
| `fieldops-digest-evening` | 6:00 PM America/Toronto | `list_shifts` (today), `get_crew_status`, `list_overdue_checkouts`, `list_alerts` (resolved=false) |

Verified via `openclaw cron run <id> --expect-final` that the scheduler correctly fires the agent turn end to end — it currently fails only at the model-call step (`model_not_found`/`No API key`), the same pre-existing blocker as the rest of the agent until real provider keys are added.

Jobs live in OpenClaw's own cron store on the Pi (`openclaw cron list`), not in this repo, so they won't survive a Pi reprovision — recreate with:

```bash
openclaw cron add --name fieldops-digest-morning --display-name "Morning Dispatch Check" \
  --agent fieldops --cron "0 6 * * *" --tz America/Toronto \
  --channel whatsapp --to "+18193196405" --announce \
  --message "Morning dispatch check. Using list_shifts for today's date and list_alerts (resolved=false), summarize who is assigned where today, flag anyone not yet confirmed, and flag any unresolved alerts. Keep it brief, no filler."

openclaw cron add --name fieldops-digest-midday --display-name "Midday Status Check" \
  --agent fieldops --cron "0 12 * * *" --tz America/Toronto \
  --channel whatsapp --to "+18193196405" --announce \
  --message "Midday status check. Using get_crew_status and list_alerts (resolved=false), summarize where the crew currently is, flag anyone idle or off-site, and flag any unresolved alerts. Keep it brief, no filler."

openclaw cron add --name fieldops-digest-evening --display-name "End-of-Day Wrap-up" \
  --agent fieldops --cron "0 18 * * *" --tz America/Toronto \
  --channel whatsapp --to "+18193196405" --announce \
  --message "End-of-day wrap-up. Using list_shifts for today's date, get_crew_status, list_overdue_checkouts, and list_alerts (resolved=false), summarize who worked today, anything still checked out, and any unresolved issues. Keep it brief, no filler."
```

**Production TODO (not built):** the owner wants these delivered to the crew group chat as well, plus a DM to a second recipient ("Nick") — needs Nick's phone number and the group's WhatsApp JID before that can be added (`--to` and `--channel`/`--account` accept only one destination per job; a second recipient means a second job per digest, or a future multi-destination delivery feature).
