import { describe, expect, it, vi } from "vitest";
import {
  canShareFiles,
  fileFromBlob,
  keepsakeFilename,
  shareFile,
  type ShareCapable,
} from "./shareTarget";

function file(name = "photo.png", type = "image/png"): File {
  return new File(["bytes"], name, { type });
}

describe("canShareFiles", () => {
  it("returns false when there is no navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(canShareFiles()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns false for null navigator", () => {
    expect(canShareFiles(null)).toBe(false);
  });

  it("returns false when share is missing", () => {
    expect(canShareFiles({ canShare: () => true })).toBe(false);
  });

  it("returns false when canShare is missing", () => {
    expect(canShareFiles({ share: async () => undefined })).toBe(false);
  });

  it("returns true when both members exist without a probe", () => {
    expect(canShareFiles({ share: async () => undefined, canShare: () => false })).toBe(true);
  });

  it("passes the actual file to canShare", () => {
    const probe = file();
    const canShare = vi.fn(() => true);
    expect(canShareFiles({ share: async () => undefined, canShare }, probe)).toBe(true);
    expect(canShare).toHaveBeenCalledWith({ files: [probe] });
  });

  it("returns false when canShare rejects a specific file", () => {
    expect(canShareFiles({ share: async () => undefined, canShare: () => false }, file())).toBe(false);
  });

  it("returns false when canShare throws", () => {
    expect(
      canShareFiles({ share: async () => undefined, canShare: () => {
        throw new Error("browser refusal");
      } }, file()),
    ).toBe(false);
  });

  it("uses the global navigator when supplied indirectly", () => {
    const nav: ShareCapable = { share: async () => undefined, canShare: () => true };
    vi.stubGlobal("navigator", nav);
    expect(canShareFiles(undefined, file())).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("shareFile", () => {
  it("shares a supported file", async () => {
    const share = vi.fn(async () => undefined);
    const nav: ShareCapable = { share, canShare: () => true };
    expect(await shareFile(file(), { nav, title: "Our keepsake" })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: expect.any(Array), title: "Our keepsake" });
  });

  it("shares without a title", async () => {
    const share = vi.fn(async () => undefined);
    const nav: ShareCapable = { share, canShare: () => true };
    expect(await shareFile(file(), { nav })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: expect.any(Array) });
  });

  it("maps AbortError to dismissed", async () => {
    const nav: ShareCapable = {
      canShare: () => true,
      share: async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); },
    };
    expect(await shareFile(file(), { nav })).toBe("dismissed");
  });

  it("maps TypeError to failed", async () => {
    const nav: ShareCapable = { canShare: () => true, share: async () => { throw new TypeError("bad"); } };
    expect(await shareFile(file(), { nav })).toBe("failed");
  });

  it("does not call share when the file is unsupported", async () => {
    const share = vi.fn(async () => undefined);
    const nav: ShareCapable = { share, canShare: () => false };
    expect(await shareFile(file(), { nav })).toBe("unsupported");
    expect(share).not.toHaveBeenCalled();
  });

  it("never rejects when share throws synchronously", async () => {
    const nav: ShareCapable = { canShare: () => true, share: () => { throw new Error("no"); } };
    await expect(shareFile(file(), { nav })).resolves.toBe("failed");
  });
});

describe("fileFromBlob", () => {
  it("prefers the explicit type", () => {
    expect(fileFromBlob(new Blob(["x"], { type: "text/plain" }), "x", "image/png").type).toBe("image/png");
  });

  it("uses the blob type when explicit type is absent", () => {
    expect(fileFromBlob(new Blob(["x"], { type: "video/mp4" }), "x").type).toBe("video/mp4");
  });

  it("uses a binary fallback when both types are absent", () => {
    expect(fileFromBlob(new Blob(["x"]), "x").type).toBe("application/octet-stream");
  });

  it("strips unsafe characters and collapses dot runs", () => {
    expect(fileFromBlob(new Blob(), `.. party's photo ..png`).name).toBe(".partysphoto.png");
  });

  it("falls back for a name made only of slashes", () => {
    expect(fileFromBlob(new Blob(), "////").name).toBe("festibooth");
  });

  it("removes quotes and spaces while retaining safe punctuation", () => {
    expect(fileFromBlob(new Blob(), `my "photo" file..png`).name).toBe("myphoto file.png".replace(" ", ""));
  });
});

describe("keepsakeFilename", () => {
  it("names a strip with a valid room", () => {
    expect(keepsakeFilename("strip", "image/png", "room_7")).toBe("festibooth-room_7.png");
  });

  it("omits a missing strip room", () => {
    expect(keepsakeFilename("strip", null)).toBe("festibooth.png");
  });

  it("names an mp4 clip", () => {
    expect(keepsakeFilename("clip", "video/mp4;codecs=h264", "abc")).toBe("festibooth-abc-live.mp4");
  });

  it("uses webm for a webm mime type", () => {
    expect(keepsakeFilename("clip", "video/webm", "abc")).toBe("festibooth-abc-live.webm");
  });

  it("uses webm for a null mime type", () => {
    expect(keepsakeFilename("clip", null)).toBe("festibooth-live.webm");
  });

  it("omits a room containing a slash", () => {
    expect(keepsakeFilename("clip", "video/mp4", "room/7")).toBe("festibooth-live.mp4");
  });
});
