# FieldOps Media Auto-Logger

Hook-only OpenClaw plugin (no agent tools) that listens for the internal `message:received` hook and, when an inbound WhatsApp message carries a photo attachment, automatically logs it as a `photo` document against the fieldops-system backend — no agent turn, no confirmation round-trip.

Why a separate plugin instead of adding this to `fieldops-tools`: `defineToolPlugin` (used by `fieldops-tools`) has no hook-registration surface. Hooks require `definePluginEntry` from `openclaw/plugin-sdk/plugin-entry`, which is a distinct plugin kind, so this had to be its own package rather than bolted onto the working 44-tool plugin.

## How it works

1. `message:received` fires for every inbound message, with `event.context.metadata` carrying provider-populated fields including `mediaPath` (local disk path — the channel adapter has already downloaded the attachment before the hook runs), `mediaType`, and `senderE164`.
2. If there's no `mediaPath`, or `mediaType` isn't `image/*` (e.g. a voice note), the handler does nothing.
3. The sender's phone (`senderE164`, falling back to digits extracted from `from`) is used to look up `GET /crew-members?phone=`. No match — skip and log; this never guesses a crew member.
4. The file at `mediaPath` is read and base64-uploaded via `POST /documents/upload` with `type: "photo"`, tagged `["auto-logged", "whatsapp"]`. No `site_id` is set — the hook has no reliable way to know which site the photo was taken at, so it isn't guessed.

Configure `backendUrl` (defaults to `http://localhost:3000/api/v1`) via the plugin's config entry if the backend isn't on localhost.

## Build

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```
