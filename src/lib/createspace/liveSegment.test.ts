import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaPipe = vi.hoisted(() => ({
  forVisionTasks: vi.fn(),
  createFromOptions: vi.fn(),
}));

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mediaPipe.forVisionTasks },
  ImageSegmenter: { createFromOptions: mediaPipe.createFromOptions },
}));

import { loadLiveSegmenter } from "./liveSegment";

beforeEach(() => {
  vi.clearAllMocks();
  mediaPipe.forVisionTasks.mockResolvedValue({ files: true });
});

describe("loadLiveSegmenter", () => {
  it("creates a closeable live video segmenter", async () => {
    const native = { close: vi.fn() };
    mediaPipe.createFromOptions.mockResolvedValue(native);

    const segmenter = await loadLiveSegmenter();
    segmenter?.close();

    expect(mediaPipe.createFromOptions).toHaveBeenCalledWith(
      { files: true },
      expect.objectContaining({
        baseOptions: expect.objectContaining({ delegate: "GPU" }),
        runningMode: "VIDEO",
      }),
    );
    expect(native.close).toHaveBeenCalledOnce();
  });

  it("falls back to CPU when GPU setup fails", async () => {
    mediaPipe.createFromOptions
      .mockRejectedValueOnce(new Error("no gpu"))
      .mockResolvedValueOnce({ close: vi.fn() });

    expect(await loadLiveSegmenter()).not.toBeNull();
    expect(mediaPipe.createFromOptions).toHaveBeenLastCalledWith(
      { files: true },
      expect.objectContaining({ baseOptions: expect.objectContaining({ delegate: "CPU" }) }),
    );
  });
});
