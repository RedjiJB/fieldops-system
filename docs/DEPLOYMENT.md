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

```bash
git clone <this-repo>
cd fieldops-system
cp .env.example .env
# fill in: POSTGRES_PASSWORD, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY,
#          OPENCLAW_GATEWAY_TOKEN, CLOUDFLARE_TUNNEL_TOKEN
docker compose up -d
```

Verify each service:

```bash
docker compose ps
docker compose logs -f postgres
docker compose logs -f backend
docker compose logs -f openclaw
```

## WhatsApp pairing

OpenClaw pairs to WhatsApp via a QR code, similar to WhatsApp Web. Use a dedicated number for the bot — not a personal number. Follow the pairing flow in OpenClaw's own docs (docs.openclaw.ai) once the gateway container is running.

## Backups

A Pi is a single point of failure sitting on a home network. Nightly `pg_dump`:

```bash
# crontab -e
0 3 * * * docker exec fieldops-postgres-1 pg_dump -U fieldops fieldops | gzip > /path/to/backups/fieldops-$(date +\%F).sql.gz
```

Sync the backup directory somewhere off the Pi (Drive, another machine, whatever's easiest) so a Pi failure costs downtime, not data — particularly the bootstrap inventory audit, which is real one-time labor worth protecting.

## Migrating off the Pi later

Everything here runs through `docker-compose.yml`. Moving to a small VPS later (if this graduates past POC) is copying the same compose file and `.env` to the new host — no architecture change required.
