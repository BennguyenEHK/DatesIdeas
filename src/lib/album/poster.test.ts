import { afterEach, describe, expect, it, vi } from "vitest";
import { POSTER_MAX_EDGE, POSTER_QUALITY, posterFromVideo, stillFromImage } from "./poster";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function imageDocument(canvas: HTMLCanvasElement): Document {
  return {
    createElement: vi.fn((tag: string) => {
      if (tag === "canvas") return canvas;
      throw new Error(`unexpected element: ${tag}`);
    }),
  } as unknown as Document;
}

describe("stillFromImage", () => {
  it("scales a large image and closes its bitmap", async () => {
    const close = vi.fn();
    const bitmap = { width: 2000, height: 1000, close } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async () => bitmap);
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
      expect(type).toBe("image/jpeg");
      expect(quality).toBe(POSTER_QUALITY);
      callback(new Blob(["still"], { type: "image/jpeg" }));
    });
    const context = { drawImage } as unknown as CanvasRenderingContext2D;
    const canvas = { getContext: vi.fn(() => context), toBlob } as unknown as HTMLCanvasElement;
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    const result = await stillFromImage(new Blob(["photo"], { type: "image/png" }), {
      document: imageDocument(canvas),
    });

    expect(result?.type).toBe("image/jpeg");
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(320);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 640, 320);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", POSTER_QUALITY);
    expect(close).toHaveBeenCalledOnce();
    expect(POSTER_MAX_EDGE).toBe(640);
  });

  it("returns null when decoding rejects", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("unsupported HEIC");
      }),
    );
    const result = await stillFromImage(new Blob(["photo"]), {
      document: imageDocument({} as HTMLCanvasElement),
    });
    expect(result).toBeNull();
  });

  it("returns null for an already-small JPEG", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 640, height: 320, close }) as unknown as ImageBitmap),
    );
    const canvas = { getContext: vi.fn() } as unknown as HTMLCanvasElement;
    const result = await stillFromImage(new Blob(["jpeg"], { type: "image/jpeg" }), {
      document: imageDocument(canvas),
    });
    expect(result).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("posterFromVideo", () => {
  it("draws a scaled frame and releases the object URL", async () => {
    const video = Object.assign(new EventTarget(), {
      muted: false,
      preload: "",
      playsInline: false,
      src: "",
      duration: 12,
      currentTime: 0,
      videoWidth: 1920,
      videoHeight: 1080,
      remove: vi.fn(),
    }) as unknown as HTMLVideoElement;
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback) =>
        callback(new Blob(["poster"], { type: "image/jpeg" })),
      ),
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "video") {
        queueMicrotask(() => {
          video.dispatchEvent(new Event("loadedmetadata"));
          queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
        });
        return video;
      }
      if (tagName === "canvas") return canvas;
      return originalCreateElement(tagName);
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:poster");
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    const result = await posterFromVideo(new Blob(["video"]));

    expect(result).toBeInstanceOf(Blob);
    expect(canvas.width).toBe(POSTER_MAX_EDGE);
    expect(canvas.height).toBe(360);
    expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 360);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", POSTER_QUALITY);
    expect(revoke).toHaveBeenCalledWith("blob:poster");
    expect(video.remove).toHaveBeenCalledOnce();
  });

  it("returns null and still cleans up when decoding fails", async () => {
    const video = Object.assign(new EventTarget(), {
      muted: false,
      preload: "",
      playsInline: false,
      duration: 0,
      remove: vi.fn(),
    }) as unknown as HTMLVideoElement;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "video") {
        queueMicrotask(() => video.dispatchEvent(new Event("loadedmetadata")));
        return video;
      }
      return originalCreateElement(tagName);
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:bad");
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    const result = await posterFromVideo(new Blob(["video"]));

    expect(result).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:bad");
    expect(video.remove).toHaveBeenCalledOnce();
  });
});
