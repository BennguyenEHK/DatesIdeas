import { describe, expect, it, vi } from "vitest";
import {
  canShareFiles,
  downloadBlob,
  fileFromBlob,
  isApplePhotosDevice,
  keepsakeFilename,
  saveRoute,
  shareFile,
  type ShareCapable,
} from "./shareTarget";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_OS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";

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

describe("isApplePhotosDevice", () => {
  it("recognises an iPhone", () => {
    expect(isApplePhotosDevice({ userAgent: IPHONE })).toBe(true);
  });

  it("recognises an iPad pretending to be a Mac", () => {
    expect(isApplePhotosDevice({ userAgent: IPAD_OS, maxTouchPoints: 5 })).toBe(true);
  });

  it("does not mistake a real Mac for an iPad", () => {
    expect(isApplePhotosDevice({ userAgent: IPAD_OS, maxTouchPoints: 0 })).toBe(false);
  });

  it("treats a Mac with no touch information as a Mac", () => {
    expect(isApplePhotosDevice({ userAgent: IPAD_OS })).toBe(false);
  });

  it("says no to Android", () => {
    expect(isApplePhotosDevice({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(false);
  });

  it("says no for a null or absent navigator", () => {
    expect(isApplePhotosDevice(null)).toBe(false);
    vi.stubGlobal("navigator", undefined);
    expect(isApplePhotosDevice()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("reads the global navigator when nothing is passed", () => {
    vi.stubGlobal("navigator", { userAgent: IPHONE });
    expect(isApplePhotosDevice()).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("saveRoute", () => {
  it("uses the sheet on an iPhone that can share the file", () => {
    expect(saveRoute(true, { userAgent: IPHONE })).toBe("share");
  });

  it("downloads on Android even though it could share", () => {
    // The whole point of the fix: a chooser is not a feature here, because a
    // downloaded image reaches the gallery on its own.
    expect(saveRoute(true, { userAgent: ANDROID })).toBe("download");
  });

  it("downloads on an iPhone that cannot share this particular file", () => {
    expect(saveRoute(false, { userAgent: IPHONE })).toBe("download");
  });

  it("downloads on a desktop", () => {
    expect(saveRoute(false, { userAgent: IPAD_OS })).toBe("download");
  });
});

describe("downloadBlob", () => {
  function fakeDocument() {
    const anchor = {
      href: "",
      download: "",
      rel: "",
      click: vi.fn(),
      remove: vi.fn(),
    };
    const doc = {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn() },
    } as unknown as Document;
    return { doc, anchor };
  }

  it("names the file itself rather than leaving it to the browser", () => {
    const { doc, anchor } = fakeDocument();
    expect(downloadBlob(new Blob(["x"], { type: "image/png" }), "festibooth-AB.png", doc)).toBe(
      true,
    );
    expect(anchor.download).toBe("festibooth-AB.png");
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });

  it("attaches the anchor before clicking it", () => {
    const { doc, anchor } = fakeDocument();
    downloadBlob(new Blob(["x"]), "x.png", doc);
    expect(doc.body.appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
  });

  it("reports failure rather than throwing when there is no document", () => {
    expect(downloadBlob(new Blob(["x"]), "x.png", null)).toBe(false);
  });

  it("reports failure when the document refuses", () => {
    const doc = {
      createElement: () => {
        throw new Error("no");
      },
      body: { appendChild: vi.fn() },
    } as unknown as Document;
    expect(downloadBlob(new Blob(["x"]), "x.png", doc)).toBe(false);
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
