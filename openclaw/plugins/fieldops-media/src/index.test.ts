import { describe, expect, it, vi } from "vitest";
import {
  extractImageMedia,
  extractSenderPhone,
  logPhotoIfPresent,
  type MediaLoggerDeps,
  type MessageReceivedContext,
} from "./index.js";

describe("extractSenderPhone", () => {
  it("prefers metadata.senderE164 when present", () => {
    expect(
      extractSenderPhone({ from: "18193196405@s.whatsapp.net", content: "", metadata: { senderE164: "+18193196405" } }),
    ).toBe("+18193196405");
  });

  it("falls back to digits from `from` when senderE164 is absent", () => {
    expect(extractSenderPhone({ from: "18193196405@s.whatsapp.net", content: "" })).toBe("+18193196405");
  });

  it("returns undefined when neither yields digits", () => {
    expect(extractSenderPhone({ from: "unknown", content: "" })).toBeUndefined();
  });
});

describe("extractImageMedia", () => {
  it("returns the path/type when mediaType is an image", () => {
    expect(
      extractImageMedia({
        from: "x",
        content: "",
        metadata: { mediaPath: "/tmp/photo.jpg", mediaType: "image/jpeg" },
      }),
    ).toEqual({ mediaPath: "/tmp/photo.jpg", mediaType: "image/jpeg" });
  });

  it("ignores non-image media (e.g. voice notes)", () => {
    expect(
      extractImageMedia({
        from: "x",
        content: "",
        metadata: { mediaPath: "/tmp/note.ogg", mediaType: "audio/ogg" },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when there is no media at all", () => {
    expect(extractImageMedia({ from: "x", content: "hello" })).toBeUndefined();
  });
});

function makeDeps(overrides: Partial<MediaLoggerDeps> = {}): MediaLoggerDeps {
  return {
    callBackend: vi.fn(async () => ({})),
    readFile: vi.fn(async () => Buffer.from("fake-image-bytes")),
    log: vi.fn(),
    ...overrides,
  };
}

describe("logPhotoIfPresent", () => {
  const photoContext: MessageReceivedContext = {
    from: "18193196405@s.whatsapp.net",
    content: "",
    metadata: { mediaPath: "/tmp/photo.jpg", mediaType: "image/jpeg", senderE164: "+18193196405" },
  };

  it("does nothing when the message has no image attachment", async () => {
    const deps = makeDeps();
    await logPhotoIfPresent({ from: "x", content: "hi there" }, deps);
    expect(deps.callBackend).not.toHaveBeenCalled();
  });

  it("skips and logs when no crew member matches the sender phone", async () => {
    const deps = makeDeps({ callBackend: vi.fn(async () => []) });
    await logPhotoIfPresent(photoContext, deps);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("no crew member registered"));
    expect(deps.readFile).not.toHaveBeenCalled();
  });

  it("uploads the photo as a document when a crew member is found", async () => {
    const callBackend = vi
      .fn()
      .mockResolvedValueOnce([{ id: "crew-123" }])
      .mockResolvedValueOnce({ id: "doc-456" });
    const deps = makeDeps({ callBackend });
    await logPhotoIfPresent(photoContext, deps);

    expect(callBackend).toHaveBeenNthCalledWith(1, "/crew-members?phone=%2B18193196405");
    const uploadCall = callBackend.mock.calls[1];
    expect(uploadCall[0]).toBe("/documents/upload");
    const body = JSON.parse((uploadCall[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      original_filename: "photo.jpg",
      mime_type: "image/jpeg",
      type: "photo",
      uploaded_by: "crew-123",
      tags: ["auto-logged", "whatsapp"],
    });
    expect(body.content_base64).toBe(Buffer.from("fake-image-bytes").toString("base64"));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("doc-456"));
  });

  it("logs and stops when the media file can't be read", async () => {
    const callBackend = vi.fn().mockResolvedValueOnce([{ id: "crew-123" }]);
    const deps = makeDeps({
      callBackend,
      readFile: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });
    await logPhotoIfPresent(photoContext, deps);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("could not read"));
    expect(callBackend).toHaveBeenCalledTimes(1);
  });
});
