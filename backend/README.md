# backend/

Postgres migrations + REST API. Not yet built — this is phase 1–2 of [../docs/ROADMAP.md](../docs/ROADMAP.md).

Reference the contract in [../docs/API.md](../docs/API.md) and schema in [../docs/DATABASE_SCHEMA.md](../docs/DATABASE_SCHEMA.md) before implementing — those are the source of truth for what this service needs to expose.

Planned layout:

```
backend/
├── Dockerfile
├── package.json (or requirements.txt / pyproject.toml)
├── src/
│   ├── db/
│   │   └── migrations/       ← one file per table/change, matching DATABASE_SCHEMA.md
│   ├── routes/                ← one file per resource group in API.md
│   ├── workers/
│   │   └── exceptions.js      ← the alerts background job described in EXCEPTION_HANDLING.md
│   └── index.js
└── tests/
```
