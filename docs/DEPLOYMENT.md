# Deployment — Self-Hosted POC (Raspberry Pi 5)

## Hardware

- Raspberry Pi 5, 8GB RAM
- **USB SSD, not the microSD card.** Postgres does frequent small writes; microSD cards wear out quickly under that pattern and this is the most common way a Pi project silently dies a few months in. Pi 5 boots natively from USB3.
- Stable power supply. A small UPS/battery pack is worth considering once the crew actually depends on this daily, though not required to start.

## Networking — Cloudflare Tunnel

The Pi isn't exposed to the internet by default, and WhatsApp messages need to reach OpenClaw's gateway. **Do not port-forward your home router.** Use Cloudflare Tunnel instead — it makes an outbound connection from the Pi to Cloudflare, which then routes traffic back through it. Nothing on the home network accepts inbound connections directly.

1. Create a Cloudflare account and a tunnel (`cloudflared tunnel create fieldops`)
2. Point a subdomain at the tunnel
3. Get a tunnel token, set it as `CLOUDFLARE_TUNNEL_TOKEN` in `.env`
4. The `cloudflared` service in `docker-compose.yml` handles the rest

## Setup

Postgres and the backend run via Docker Compose. OpenClaw does **not** — confirmed by actually installing it — it's a CLI tool that runs as its own native systemd service on the host, not a container.

```bash
git clone <this-repo>
cd fieldops-system
cp .env.example .env
# fill in: POSTGRES_PASSWORD, CLOUDFLARE_TUNNEL_TOKEN
docker compose up -d postgres backend
docker compose exec backend npm run migrate
```

Verify:

```bash
docker compose ps
docker compose logs -f postgres
docker compose logs -f backend
curl http://localhost:3000/health
```

## Dashboard auth rollout

The backend API had zero authentication until the web dashboard needed to expose it to the internet. Auth now guards every `/api/v1/*` route via one of two credential types: the agent's static service token, or a dashboard user's session cookie. **The agent's calls have no concept of logging in** — the rollout order below exists specifically so deploying auth never breaks the live WhatsApp pipeline. Do these in order, on the Pi, over SSH:

1. **Generate a token** (a human runs this, not scripted):
   ```bash
   openssl rand -hex 32
   ```
2. **Set it on the agent side first** — this must land before the backend starts enforcing auth:
   ```bash
   openclaw config set plugins.entries.fieldops-tools.config.serviceToken "<the token>"
   systemctl --user restart openclaw-gateway
   ```
3. **Verify the agent still works** before touching the backend — trigger a real tool call (a cron digest run, or a real WhatsApp message) and confirm it still returns real data. If this step is skipped and step 4 happens first, the agent silently loses backend access.
4. **Set the same token for the backend**, in `.env`:
   ```
   AGENT_SERVICE_TOKEN=<the same token>
   ```
5. **Deploy the auth-enforcing backend and run migrations**:
   ```bash
   docker compose up -d --build backend
   docker compose exec backend npm run migrate
   ```
6. **Create your own dashboard account, interactively** — there is no public register endpoint:
   ```bash
   docker compose exec backend npm run create-user
   ```
7. **Re-verify the agent** one more time (same check as step 3) — this confirms the service-token path survived the real deploy, not just the config-side restart.
8. **Bring up the dashboard**:
   ```bash
   docker compose up -d --build frontend
   ```
9. **Add one Cloudflare Tunnel public hostname** for the dashboard, in the Cloudflare Zero Trust dashboard (this repo's tunnel is remotely managed via `CLOUDFLARE_TUNNEL_TOKEN`, so ingress routes are configured cloud-side, not in a local `config.yml`): a new public hostname (e.g. `dashboard.<your-domain>`) pointed at `http://frontend:80`.

### Installing OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw onboard --non-interactive --accept-risk --auth-choice skip \
  --skip-channels --skip-skills --skip-search --skip-ui \
  --gateway-bind loopback --install-daemon
openclaw config set tools.profile messaging   # not the "coding" default — this agent talks to crew, not a codebase
```

`onboard --install-daemon` registers `openclaw-gateway.service` as a **systemd user service** with lingering enabled, so it keeps running without an active login session. Check it with:

```bash
openclaw gateway status
openclaw daemon status
```

Add a model provider afterward (`openclaw onboard` again, or `openclaw config set` — see ARCHITECTURE.md for DeepSeek primary / Claude fallback) once real API keys are available. Then install the tool plugin(s) under `openclaw/plugins/` — see `openclaw/README.md`.

## WhatsApp pairing

```bash
openclaw channels login --channel whatsapp
```

This pairs via a QR code, similar to WhatsApp Web — scan it with the phone that owns the bot's number. Use a dedicated number, not a personal one. This step needs a phone physically present; it can't be scripted.

## Backups

A Pi is a single point of failure sitting on a home network. Nightly `pg_dump`:

```bash
# crontab -e
0 3 * * * docker exec fieldops-postgres-1 pg_dump -U fieldops fieldops | gzip > /path/to/backups/fieldops-$(date +\%F).sql.gz
```

Sync the backup directory somewhere off the Pi (Drive, another machine, whatever's easiest) so a Pi failure costs downtime, not data — particularly the bootstrap inventory audit, which is real one-time labor worth protecting.

## Migrating off the Pi later

Postgres and the backend run through `docker-compose.yml` — moving those to a small VPS later is copying the compose file and `.env` to the new host. OpenClaw would need a fresh `curl | bash` install + `onboard` on the new host, since it isn't containerized here.
