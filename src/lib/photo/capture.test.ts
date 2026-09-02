import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFrame, frameToBlob, MAX_CAPTURE_WIDTH } from "./capture";

type ContextFake = {
  drawImage: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
};

type CanvasFake = HTMLCanvasElement & {
  context: CanvasRenderingContext2D | null;
  toBlob: ReturnType<typeof vi.fn>;
};

const originalCreateElement = document.createElement.bind(document);

const makeVideo = (readyState = 2, videoWidth = 1920, videoHeight = 1080) =>
  ({ readyState, videoWidth, videoHeight } as HTMLVideoElement);

const installCanvas = (context: CanvasRenderingContext2D | null) => {
  const canvas = {
    width: 0,
    height: 0,
    context,
    getContext: vi.fn(() => context),
    toBlob: vi.fn(),
  } as unknown as CanvasFake;
  vi.spyOn(document, "createElement").mockImplementation((tagName) => {
    if (tagName === "canvas") return canvas;
    return originalCreateElement(tagName);
  });
  return canvas;
};

const makeContext = (): ContextFake => ({
  drawImage: vi.fn(),
  save: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  restore: vi.fn(),
});

afterEach(() => vi.restoreAllMocks());

describe("captureFrame", () => {
  it.each([
    ["a null video", null],
    ["a video without current data", makeVideo(1)],
    ["a video with zero width", makeVideo(2, 0, 1080)],
    ["a video with zero height", makeVideo(2, 1920, 0)],
  ])("returns null for %s", (_description, video) => {
    expect(captureFrame(video)).toBeNull();
  });

  it("scales a 1920x1080 source to 1280x720", () => {
    const context = makeContext();
    const canvas = installCanvas(context as unknown as CanvasRenderingContext2D);

    const frame = captureFrame(makeVideo());

    expect(frame).toMatchObject({ width: 1280, height: 720, canvas });
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1280,
      720,
    );
  });

  it("leaves a 640x480 source alone rather than enlarging it", () => {
    const canvas = installCanvas(makeContext() as unknown as CanvasRenderingContext2D);

    expect(captureFrame(makeVideo(2, 640, 480))).toMatchObject({
      canvas,
      width: 640,
      height: 480,
    });
    expect(MAX_CAPTURE_WIDTH).toBe(1280);
  });

  it("preserves aspect ratio with whole-pixel rounding", () => {
    installCanvas(makeContext() as unknown as CanvasRenderingContext2D);

    expect(captureFrame(makeVideo(2, 1001, 667), { maxWidth: 500 })).toMatchObject({
      width: 500,
      height: 333,
    });
  });

  it("flips mirrored captures horizontally", () => {
    const context = makeContext();
    installCanvas(context as unknown as CanvasRenderingContext2D);

    captureFrame(makeVideo(), { mirrored: true });

    expect(context.save).toHaveBeenCalledOnce();
    expect(context.translate).toHaveBeenCalledWith(1280, 0);
    expect(context.scale).toHaveBeenCalledWith(-1, 1);
    expect(context.restore).toHaveBeenCalledOnce();
  });

  it("does not flip unmirrored captures", () => {
    const context = makeContext();
    installCanvas(context as unknown as CanvasRenderingContext2D);

    captureFrame(makeVideo(), { mirrored: false });

    expect(context.save).not.toHaveBeenCalled();
    expect(context.translate).not.toHaveBeenCalled();
    expect(context.scale).not.toHaveBeenCalled();
    expect(context.restore).not.toHaveBeenCalled();
  });

  it("returns null when the browser cannot provide a 2d context", () => {
    installCanvas(null);

    expect(captureFrame(makeVideo())).toBeNull();
  });
});

describe("frameToBlob", () => {
  it("resolves null when the browser declines to create a blob", async () => {
    const canvas = installCanvas(null);
    canvas.toBlob.mockImplementation((callback: (blob: Blob | null) => void) =>
      callback(null),
    );

    await expect(frameToBlob({ canvas, width: 1, height: 1 })).resolves.toBeNull();
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
  });
});
