import fs from "node:fs/promises";
import path from "node:path";
import { buildJsonPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// Minimal shape of what we read off the internal "message:received" hook
// event — see MessageReceivedHookContext in openclaw's internal-hooks types.
// metadata.mediaPath/mediaType are populated by the channel adapter once a
// WhatsApp media attachment has already been downloaded to local disk.
export type MessageReceivedContext = {
  from: string;
  content: string;
  metadata?: Record<string, unknown>;
};

const DEFAULT_BACKEND_URL = "http://localhost:3000/api/v1";

export function extractSenderPhone(context: MessageReceivedContext): string | undefined {
  const e164 = context.metadata?.senderE164;
  if (typeof e164 === "string" && e164.trim().length > 0) return e164.trim();
  const digits = context.from.replace(/[^0-9]/g, "");
  return digits.length > 0 ? `+${digits}` : undefined;
}

export function extractImageMedia(
  context: MessageReceivedContext,
): { mediaPath: string; mediaType: string } | undefined {
  const mediaPath = context.metadata?.mediaPath;
  const mediaType = context.metadata?.mediaType;
  if (typeof mediaPath !== "string" || mediaPath.trim().length === 0) return undefined;
  if (typeof mediaType !== "string" || !mediaType.startsWith("image/")) return undefined;
  return { mediaPath, mediaType };
}

export type BackendCaller = (path: string, init?: RequestInit) => Promise<unknown>;

export function makeBackendCaller(backendUrl: string): BackendCaller {
  return async (relativePath, init) => {
    const res = await fetch(`${backendUrl}${relativePath}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { error: true, status: res.status, message: (body as { error?: string })?.error ?? res.statusText };
    }
    return body;
  };
}

export type MediaLoggerDeps = {
  callBackend: BackendCaller;
  readFile: (filePath: string) => Promise<Buffer>;
  log: (message: string) => void;
};

export async function logPhotoIfPresent(
  context: MessageReceivedContext,
  deps: MediaLoggerDeps,
): Promise<string | undefined> {
  const media = extractImageMedia(context);
  if (!media) return undefined;

  const phone = extractSenderPhone(context);
  if (!phone) {
    deps.log("fieldops-media: skipped photo — no resolvable sender phone number");
    return undefined;
  }

  const crewMembers = (await deps.callBackend(`/crew-members?phone=${encodeURIComponent(phone)}`)) as
    | { id: string }[]
    | { error: true; message: string };
  if (!Array.isArray(crewMembers) || crewMembers.length === 0) {
    deps.log(`fieldops-media: skipped photo — no crew member registered for ${phone}`);
    return undefined;
  }
  const uploadedBy = crewMembers[0].id;

  let fileBuffer: Buffer;
  try {
    fileBuffer = await deps.readFile(media.mediaPath);
  } catch (err) {
    deps.log(`fieldops-media: skipped photo — could not read ${media.mediaPath}: ${String(err)}`);
    return undefined;
  }

  const result = await deps.callBackend("/documents/upload", {
    method: "POST",
    body: JSON.stringify({
      content_base64: fileBuffer.toString("base64"),
      original_filename: path.basename(media.mediaPath),
      mime_type: media.mediaType,
      type: "photo",
      uploaded_by: uploadedBy,
      tags: ["auto-logged", "whatsapp"],
    }),
  });

  if (result && typeof result === "object" && "error" in result) {
    deps.log(`fieldops-media: upload failed for ${phone}: ${JSON.stringify(result)}`);
    return undefined;
  }
  const documentId = (result as { id?: string })?.id;
  deps.log(`fieldops-media: logged photo from ${phone} as document ${documentId ?? "?"}`);
  return documentId;
}

// Bridges "the hook knows a photo's document id" to "the agent turn can act
// on it" -- message:received is fire-and-forget and can't inject anything
// into the prompt, so we hand the id off via a short-lived, session-keyed
// map and pick it up in agent_turn_prepare (a typed hook that can). TTL and
// consume-once are defensive: "one message = one serialized turn per
// session" isn't a documented guarantee, so a stale/mismatched entry expires
// rather than silently attaching to a much later, unrelated turn.
const PENDING_TTL_MS = 3 * 60 * 1000;
const pendingClassifications = new Map<string, { documentId: string; uploadedAt: number }>();

const configSchema = buildJsonPluginConfigSchema({
  type: "object",
  properties: {
    backendUrl: {
      type: "string",
      description: "FieldOps backend API base URL, e.g. http://localhost:3000/api/v1",
    },
  },
});

const entry: ReturnType<typeof definePluginEntry> = definePluginEntry({
  id: "fieldops-media",
  name: "FieldOps Media Auto-Logger",
  description:
    "Automatically logs WhatsApp photo attachments (job progress, receipts, damage) as documents against the FieldOps backend, resolving the sender's phone to a crew member.",
  configSchema,
  register(api) {
    const backendUrl = (api.pluginConfig?.backendUrl as string | undefined) ?? DEFAULT_BACKEND_URL;
    const deps: MediaLoggerDeps = {
      callBackend: makeBackendCaller(backendUrl),
      readFile: (filePath) => fs.readFile(filePath),
      log: (message) => api.logger.info(message),
    };

    api.registerHook(
      "message:received",
      async (event) => {
        const documentId = await logPhotoIfPresent(event.context as MessageReceivedContext, deps);
        if (documentId) {
          pendingClassifications.set(event.sessionKey, { documentId, uploadedAt: Date.now() });
        }
      },
      {
        name: "fieldops-media-photo-logger",
        description: "Auto-logs inbound WhatsApp photo attachments as documents",
      },
    );

    // Hands the just-uploaded document id to the same turn's prompt so the
    // agent can call classify_document (fieldops-tools) if the image
    // description names something more specific than the 'photo' default --
    // see AGENTS.md's "Photo classification" section for the agent-facing
    // rules. Consume-once + TTL, per the comment on pendingClassifications above.
    api.on("agent_turn_prepare", (_event, ctx) => {
      if (!ctx.sessionKey) return;
      const pending = pendingClassifications.get(ctx.sessionKey);
      if (!pending) return;
      pendingClassifications.delete(ctx.sessionKey);
      if (Date.now() - pending.uploadedAt > PENDING_TTL_MS) return;
      return {
        appendContext:
          `A photo was just auto-filed as document ${pending.documentId} (type: 'photo', a safe default). ` +
          `If the image description above clearly shows a receipt, permit, contract, insurance certificate, or ` +
          `disposal ticket, call classify_document with id: "${pending.documentId}" and the matching type — do ` +
          `this silently, no need to mention it in your reply. Equipment, damage, and job-progress photos should ` +
          `stay 'photo' (there's no more specific type for them) — leave those alone, no action needed.`,
      };
    });
  },
});

export default entry;
