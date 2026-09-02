import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Frame } from "./capture";

const forVisionTasks = vi.fn();
const createFromOptions = vi.fn();

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks },
  ImageSegmenter: { createFromOptions },
}));

interface FakeCanvas {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  context: ReturnType<typeof fakeContext>;
}

function fakeContext(canvas: { data: Uint8ClampedArray }) {
  return {
    drawImage: vi.fn((source: unknown) => {
      const data = (source as Partial<FakeCanvas>).data;
      if (data !== undefined) canvas.data = new Uint8ClampedArray(data);
    }),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(canvas.data) })),
    putImageData: vi.fn((image: ImageData) => {
      canvas.data = new Uint8ClampedArray(image.data);
    }),
  };
}

function canvas(data = [10, 20, 30, 200]): HTMLCanvasElement {
  const fake = { width: 1, height: 1, data: new Uint8ClampedArray(data) } as FakeCanvas;
  fake.context = fakeContext(fake);
  return Object.assign(fake, { getContext: vi.fn(() => fake.context) }) as unknown as HTMLCanvasElement;
}

function frame(data?: number[]): Frame {
  return { canvas: canvas(data), width: 1, height: 1 };
}

function mask(value = 0.5) {
  return { getAsFloat32Array: vi.fn(() => new Float32Array([value])), close: vi.fn() };
}

async function subject() {
  vi.resetModules();
  return import("./segment");
}

beforeEach(() => {
  vi.clearAllMocks();
  forVisionTasks.mockResolvedValue({ wasm: true });
  createFromOptions.mockResolvedValue({ segment: vi.fn(() => ({ confidenceMasks: [mask(0), mask()] })) });
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas()) });
});

describe("photo segmentation", () => {
  it("creates one segmenter and reuses it", async () => {
    const { loadSegmenter } = await subject();

    expect(await loadSegmenter()).not.toBeNull();
    expect(await loadSegmenter()).not.toBeNull();
    expect(createFromOptions).toHaveBeenCalledTimes(1);
  });

  it("tries GPU before falling back to CPU", async () => {
    createFromOptions.mockRejectedValueOnce(new Error("no GPU"));
    const { loadSegmenter } = await subject();

    await loadSegmenter();

    expect(createFromOptions).toHaveBeenCalledTimes(2);
    expect(createFromOptions.mock.calls.map(([, options]) => options.baseOptions.delegate)).toEqual(["GPU", "CPU"]);
  });

  it("returns null instead of throwing when both delegates fail", async () => {
    createFromOptions.mockRejectedValue(new Error("unavailable"));
    const { loadSegmenter } = await subject();

    await expect(loadSegmenter()).resolves.toBeNull();
  });

  it("returns the original when no segmenter can be created", async () => {
    createFromOptions.mockRejectedValue(new Error("unavailable"));
    const { cutOutOrOriginal } = await subject();
    const original = frame();

    await expect(cutOutOrOriginal(original)).resolves.toBe(original);
  });

  it("returns the original when segmenter creation throws", async () => {
    forVisionTasks.mockRejectedValue(new Error("wasm unavailable"));
    const { cutOutOrOriginal } = await subject();
    const original = frame();

    await expect(cutOutOrOriginal(original)).resolves.toBe(original);
  });

  it("returns the original when cutting out throws", async () => {
    const { cutOutOrOriginal, loadSegmenter } = await subject();
    const loaded = await loadSegmenter();
    const original = frame();
    if (loaded === null) throw new Error("test setup did not create a segmenter");
    loaded.cutOut = vi.fn(() => { throw new Error("bad mask"); });

    await expect(cutOutOrOriginal(original)).resolves.toBe(original);
  });

  it("creates a new transparent-background frame without mutating its input", async () => {
    const foreground = mask(0.5);
    createFromOptions.mockResolvedValue({ segment: vi.fn(() => ({ confidenceMasks: [mask(0), foreground] })) });
    const { loadSegmenter } = await subject();
    const original = frame([10, 20, 30, 200]);
    const loaded = await loadSegmenter();
    if (loaded === null) throw new Error("test setup did not create a segmenter");

    const result = loaded.cutOut(original);

    expect(result).not.toBe(original);
    expect((original.canvas as unknown as FakeCanvas).data).toEqual(new Uint8ClampedArray([10, 20, 30, 200]));
    expect((result.canvas as unknown as FakeCanvas).data).toEqual(new Uint8ClampedArray([10, 20, 30, 100]));
  });

  it("closes confidence masks after their values are copied", async () => {
    const background = mask(0);
    const foreground = mask();
    createFromOptions.mockResolvedValue({ segment: vi.fn(() => ({ confidenceMasks: [background, foreground] })) });
    const { loadSegmenter } = await subject();
    const loaded = await loadSegmenter();
    if (loaded === null) throw new Error("test setup did not create a segmenter");

    loaded.cutOut(frame());

    expect(background.close).toHaveBeenCalledOnce();
    expect(foreground.close).toHaveBeenCalledOnce();
  });
});
