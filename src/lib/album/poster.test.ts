import { afterEach, describe, expect, it, vi } from "vitest";
import { POSTER_MAX_EDGE, POSTER_QUALITY, posterFromVideo } from "./poster";

afterEach(() => vi.restoreAllMocks());

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
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(["poster"], { type: "image/jpeg" }))),
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
      if (tagName === "canvas") {
        return canvas;
      }
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
    const originalCreateElement = document.createElement.bind(document);
    const video = Object.assign(new EventTarget(), {
      muted: false,
      preload: "",
      playsInline: false,
      src: "",
      duration: 0,
      remove: vi.fn(),
    }) as unknown as HTMLVideoElement;
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
