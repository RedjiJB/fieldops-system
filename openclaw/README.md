# openclaw/

OpenClaw gateway configuration and agent tool definitions.

- `openclaw.config.example.json` — copy to `openclaw.config.json`, fill in real values. Model config: DeepSeek primary, Claude Sonnet 5 fallback (see [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)). Verify field names against [docs.openclaw.ai](https://docs.openclaw.ai) before relying on this — schema details can drift between versions.
- Agent tool definitions (mapping the backend API in [../docs/API.md](../docs/API.md) to callable tools) and the system prompt — including the vocabulary from [../docs/GLOSSARY.md](../docs/GLOSSARY.md) and the confirm-before-execute rule — are phase 2 of the build, not yet written.
