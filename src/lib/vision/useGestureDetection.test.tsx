import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGestureDetection } from "./useGestureDetection";

/**
 * Regression tests for the dead gesture pipeline.
 *
 * The hook used to list `ready` in its effect's dependency array. The effect
 * therefore tore down and rebuilt the worker the instant that worker reported
 * itself ready — terminating the one that had just finished loading MediaPipe.
 * Its replacement was handed frames while still initializing, replied with
 * nothing, and left `inFlight` latched true, so the pump stalled on its first
 * frame and never sent another. Meanwhile `ready` was already true in state,
 * so the status bar read "Gestures on" over a pipeline that was doing nothing.
 */

interface WorkerMessage {
  type: string;
  [k: string]: unknown;
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: WorkerMessage[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: WorkerMessage) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  /** Simulate a message coming back out of the worker. */
  emit(data: WorkerMessage) {
    this.onmessage?.({ data } as MessageEvent);
  }
  frames() {
    return this.posted.filter((m) => m.type === "frame");
  }
}

/** A frame the tracker will accept but that fires no gesture. */
const blankFrame = (timestamp: number) => ({
  type: "frame",
  frame: { timestamp, smileScore: 0, hands: [] },
});

const stream = {
  getVideoTracks: () => [{ kind: "video" }],
} as unknown as MediaStream;

let videoCallbacks: FrameRequestCallback[] = [];

/** Runs whatever the pump registered with requestVideoFrameCallback. */
function nextVideoFrame() {
  const due = videoCallbacks;
  videoCallbacks = [];
  for (const cb of due) cb(performance.now());
}

beforeEach(() => {
  FakeWorker.instances = [];
  videoCallbacks = [];

  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("createImageBitmap", () =>
    Promise.resolve({ close: () => {} } as unknown as ImageBitmap),
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
    configurable: true,
    writable: true,
    value: (cb: FrameRequestCallback) => {
      videoCallbacks.push(cb);
      return videoCallbacks.length;
    },
  });
  Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
    configurable: true,
    writable: true,
    value: () => {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)
    .requestVideoFrameCallback;
  delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)
    .cancelVideoFrameCallback;
});

describe("useGestureDetection", () => {
  it("builds exactly one worker and initializes it", async () => {
    renderHook(() => useGestureDetection(stream, () => {}, true));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    expect(FakeWorker.instances[0].posted[0]).toEqual({ type: "init" });
  });

  it("does NOT rebuild the worker when it reports ready", async () => {
    const { result } = renderHook(() => useGestureDetection(stream, () => {}, true));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];

    act(() => worker.emit({ type: "ready" }));

    await waitFor(() => expect(result.current.ready).toBe(true));
    // The regression: a second instance here means the ready worker was killed.
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.terminated).toBe(false);
  });

  it("sends no frames before the worker is ready", async () => {
    renderHook(() => useGestureDetection(stream, () => {}, true));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];

    await act(async () => {
      nextVideoFrame();
      nextVideoFrame();
    });
    expect(worker.frames()).toHaveLength(0);
  });

  it("pumps frames once the worker is ready", async () => {
    renderHook(() => useGestureDetection(stream, () => {}, true));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    act(() => worker.emit({ type: "ready" }));

    await act(async () => nextVideoFrame());
    await waitFor(() => expect(worker.frames()).toHaveLength(1));
  });

  it("keeps pumping after each frame is answered", async () => {
    renderHook(() => useGestureDetection(stream, () => {}, true));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    act(() => worker.emit({ type: "ready" }));

    for (let i = 1; i <= 3; i++) {
      await act(async () => nextVideoFrame());
      await waitFor(() => expect(worker.frames()).toHaveLength(i));
      act(() => worker.emit(blankFrame(i * 100)));
    }
  });

  it("recovers when the worker cannot process a frame", async () => {
    // The worker replies `idle` rather than staying silent. Without that reply
    // the pump latches on its first unanswered frame and never sends again.
    renderHook(() => useGestureDetection(stream, () => {}, true));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    act(() => worker.emit({ type: "ready" }));

    await act(async () => nextVideoFrame());
    await waitFor(() => expect(worker.frames()).toHaveLength(1));
    act(() => worker.emit({ type: "idle" }));

    await act(async () => nextVideoFrame());
    await waitFor(() => expect(worker.frames()).toHaveLength(2));
  });

  it("reports gestures the tracker fires", async () => {
    const seen: string[] = [];
    renderHook(() => useGestureDetection(stream, (id) => seen.push(id), true));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    act(() => worker.emit({ type: "ready" }));

    // A smile must be held past HOLD_MS before it counts as an event.
    const smiling = (timestamp: number) => ({
      type: "frame",
      frame: { timestamp, smileScore: 0.9, hands: [] },
    });
    act(() => worker.emit(smiling(0)));
    expect(seen).toEqual([]);
    act(() => worker.emit(smiling(400)));
    expect(seen).toEqual(["smile"]);
  });

  it("surfaces a worker failure instead of pretending gestures work", async () => {
    const { result } = renderHook(() => useGestureDetection(stream, () => {}, true));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));

    act(() =>
      FakeWorker.instances[0].emit({ type: "error", message: "no WebGL" }),
    );
    await waitFor(() => expect(result.current.error).toBe("no WebGL"));
    expect(result.current.ready).toBe(false);
  });

  it("falls back to an interval pump where rVFC is missing (Firefox)", async () => {
    delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)
      .requestVideoFrameCallback;
    vi.useFakeTimers();
    try {
      renderHook(() => useGestureDetection(stream, () => {}, true));
      await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
      const worker = FakeWorker.instances[0];
      worker.emit({ type: "ready" });

      await vi.advanceTimersByTimeAsync(200);
      expect(worker.frames().length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates the worker on unmount", async () => {
    const { unmount } = renderHook(() => useGestureDetection(stream, () => {}, true));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    unmount();
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("builds nothing while gestures are switched off", () => {
    renderHook(() => useGestureDetection(stream, () => {}, false));
    // Not merely muted: MediaPipe never starts, so the camera is not analysed
    // and the laptop is not warmed for nothing.
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("tears the worker down when switched off mid-call", async () => {
    const { rerender } = renderHook(
      ({ on }) => useGestureDetection(stream, () => {}, on),
      { initialProps: { on: true } },
    );
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));

    rerender({ on: false });
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("rebuilds the worker when switched back on", async () => {
    const { rerender } = renderHook(
      ({ on }) => useGestureDetection(stream, () => {}, on),
      { initialProps: { on: true } },
    );
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));

    rerender({ on: false });
    rerender({ on: true });

    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    expect(FakeWorker.instances[1].terminated).toBe(false);
    expect(FakeWorker.instances[1].posted[0]).toEqual({ type: "init" });
  });

  it("reports not-ready while switched off", async () => {
    const { result, rerender } = renderHook(
      ({ on }) => useGestureDetection(stream, () => {}, on),
      { initialProps: { on: true } },
    );
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    act(() => FakeWorker.instances[0].emit({ type: "ready" }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    rerender({ on: false });
    // Claiming "on" with no worker behind it is the exact lie that made the
    // original bug invisible.
    await waitFor(() => expect(result.current.ready).toBe(false));
  });

  it("does nothing without a video track", () => {
    const audioOnly = { getVideoTracks: () => [] } as unknown as MediaStream;
    renderHook(() => useGestureDetection(audioOnly, () => {}, true));
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
