# TOOLS.md — Local Notes

## fieldops-tools plugin

38 tools wrapping the fieldops backend REST API. Source: `../plugins/fieldops-tools/` in the repo (`~/fieldops-system/openclaw/plugins/fieldops-tools` on this Pi).

- `backendUrl` config defaults to `http://localhost:3000/api/v1` — correct as long as the backend runs on this same Pi via `docker-compose.yml`. If that ever changes, update the plugin's config entry.
- Full tool list and what each does: `../plugins/fieldops-tools/README.md`.
- Business rules each tool enforces: see AGENTS.md's "Business rules the backend enforces" section — that's the operational cheat sheet, this file is just plumbing notes.

## Backend

- Postgres + Express backend run via Docker Compose on this same Pi (`~/fieldops-system`, services `postgres` and `backend`).
- Health check: `curl http://localhost:3000/health`.
- If tool calls start failing with connection errors, check `docker compose ps` and `docker compose logs backend` in `~/fieldops-system` first.
