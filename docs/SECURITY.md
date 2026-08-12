# Security

A working audit of this system as actually built, not a generic checklist — findings below were verified against the real running system on 2026-08-12, not assumed.

## Threat model

- **Prompt injection (direct)**: mitigated by `AGENTS.md`'s confirm-before-execute rule — any mutating tool call must be echoed back and confirmed before it runs, so a hijacked turn can't silently move inventory/money/schedule. Not airtight: `openclaw/agent-tests/` originally caught DeepSeek skipping confirmation for `register_vehicle` in 2 of 12 real runs. Root-caused to the model treating "nothing left to ask" (a fully-specified request) as equivalent to "nothing to confirm" — `AGENTS.md` was updated 2026-08-12 to call this out explicitly as the *opposite* of an exception. Re-verified over 7 subsequent runs each of the two affected scenarios: 6/7 passed on both, versus 0/2 before the fix. Better odds, not a guarantee — this remains a model reliability limit, not something a prompt edit fully closes.
- **Prompt injection (indirect)**: free-text fields a crew member controls once (an order's `spec_notes`, a document's tags) get read back into the agent's context on a *later* turn via `list_*` tools. Adversarial text planted there could influence that later turn. Not eliminated — the real mitigation is confirm-before-execute limiting what that later turn can actually *do*, plus keeping `channels.whatsapp.dmPolicy: allowlist` tight so only trusted people can plant the text in the first place.
- **Spam / cost control**: `dmPolicy: allowlist` currently permits only the owner's own number — verified low risk today, but the allowlist will grow as real crew get onboarded, and the fixes below (debounce) need to already be in place before that happens.
- **Network exposure**: Postgres/backend/frontend are all bound to `127.0.0.1` only (see `docker-compose.yml`) — nothing accepts inbound connections directly; external access is only through Cloudflare Tunnel. No port-forwarding.

## Fixed 2026-08-12

- **Stored-XSS-via-file-serving** — `GET /documents/:id/file` served a WhatsApp sender's self-reported `mime_type` with `Content-Disposition: inline` and no validation; a file claiming to be `text/html` would have rendered inline in a browser. Fixed: `POST /documents/upload` now rejects anything outside a real allowlist (`backend/src/routes/documents.ts`'s `SAFE_MIME_TYPES` — image types + PDF), the serving route adds `X-Content-Type-Options: nosniff`, and only image types get `inline`; everything else is forced to `attachment` regardless of what's stored (covers pre-existing rows from before this fix existed).
- **Credentials directory world/group-writable** — `~/.openclaw/credentials` was mode `775` (`openclaw security audit` flags this CRITICAL). Fixed: `chmod 700`.
- **Unpinned plugin supply chain** — `@openclaw/whatsapp` was installed as a bare spec (`@openclaw/whatsapp`, no version), so a future `openclaw plugins update` could silently pull a different build. Fixed: reinstalled pinned to the exact running version (`@openclaw/whatsapp@2026.7.1`) via `openclaw plugins install ... --force`; verified the live WhatsApp pairing survived (`openclaw channels list` → still `linked`) and the agent pipeline still works end to end afterward.
- **No login rate limiting** — `POST /auth/login` is the one endpoint a stranger can hit without already holding a credential (everything else needs a session or the agent's service token) — the classic brute-force target. Fixed: `express-rate-limit`, 10 attempts / 15 min per IP (`backend/src/routes/auth.ts`). Verified: 11 rapid attempts → the 11th gets `429`.
- **No cost throttling on WhatsApp message volume** — `channels.whatsapp.debounceMs` was `0`, so every message (even a rapid burst) triggered a separate paid model call. Set to `2000`ms — also has the side benefit of collapsing quick multi-message bursts into one agent turn instead of several, which fits the "message correction" pattern `AGENTS.md` already documents.

## Still open — needs a human at an interactive terminal

`openclaw secrets audit` finds 2 plaintext secrets: `gateway.auth.token` (in `openclaw.json`) and the DeepSeek API key (in the main agent's auth store). `openclaw secrets configure` is how OpenClaw migrates these to SecretRefs — **it refuses to run non-interactively** ("requires an interactive TTY"), and it's not something to run unattended anyway given it touches the already-working gateway auth and the real DeepSeek key. Run it yourself, on the Pi, in a real terminal:

```bash
openclaw secrets configure
```

Verify afterward with `openclaw secrets audit` (should show `plaintext=0`), then confirm the agent still works (`openclaw cron run <a digest job id> --expect-final`) before considering it done.

## Explicitly not done

Broad backend API rate limiting — the rest of `/api/v1/*` is already behind `requireAuth` (session or service token), so a blanket per-IP limit wouldn't meaningfully change the threat model given the current trust boundary (one agent, one dashboard's worth of logged-in users). CSRF tokens beyond `SameSite=Lax` (documented as deferred in the dashboard v1 plan). Any hardening for a scenario where the WhatsApp allowlist grows to include untrusted parties — the current design assumes everyone on `dmPolicy.allowFrom` is trusted.
