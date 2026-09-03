import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLiveFilm } from "./useLiveFilm";
import { theme } from "./themes";
import type { Clip, Recording } from "./record";

const started: Array<{ stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }> = [];

vi.mock("./record", () => ({
  startRecording: vi.fn(() => {
    const entry = {
      stop: vi.fn<() => Promise<Clip | null>>(() => Promise.resolve(null)),
      cancel: vi.fn(),
    };
    started.push(entry);
    return entry as unknown as Recording;
  }),
}));

function clip(size: number): Clip {
  return { blob: new Blob([new Uint8Array(size)]), mimeType: "video/webm", durationMs: 7000 };
}

/** A hook with a canvas attached, the way the stage attaches one. */
function film() {
  const local = { current: null } as React.RefObject<HTMLVideoElement | null>;
  const remote = { current: null } as React.RefObject<HTMLVideoElement | null>;
  const rendered = renderHook(() => useLiveFilm({ localVideo: local, remoteVideo: remote }));
  act(() => {
    rendered.result.current.canvasRef.current = document.createElement("canvas");
  });
  return rendered;
}

beforeEach(() => {
  started.length = 0;
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("useLiveFilm", () => {
  it("makes room for exactly as many clips as there are shots", () => {
    const { result } = film();
    act(() => result.current.reset(4));
    expect(result.current.clips).toEqual([null, null, null, null]);
    expect(result.current.clips.some((c) => c !== null)).toBe(false);
  });

  it("keeps a finished clip against the shot that produced it", async () => {
    const { result } = film();
    act(() => result.current.reset(2));
    act(() => result.current.begin(theme("griffith")));

    started[0].stop.mockResolvedValueOnce(clip(64));
    await act(async () => {
      result.current.end(1);
    });

    expect(result.current.clips[0]).toBeNull();
    expect(result.current.clips[1]?.blob.size).toBe(64);
    expect(result.current.clips.some((c) => c !== null)).toBe(true);
  });

  it("reports a clip the browser could not produce as simply absent", async () => {
    const { result } = film();
    act(() => result.current.reset(2));
    act(() => result.current.begin(theme("griffith")));
    await act(async () => {
      result.current.end(0);
    });

    expect(result.current.clips).toEqual([null, null]);
    expect(result.current.clips.some((c) => c !== null)).toBe(false);
  });

  /**
   * A sitting thrown away while a clip was still being finalised. Without the
   * length guard the late arrival would grow the array back and offer a
   * keepsake from an evening that no longer exists.
   */
  it("drops a clip that lands after its sitting was reset away", async () => {
    const { result } = film();
    act(() => result.current.reset(4));
    act(() => result.current.begin(theme("griffith")));

    started[0].stop.mockResolvedValueOnce(clip(32));
    act(() => {
      result.current.end(3);
      // The next sitting is shorter, so index 3 no longer exists.
      result.current.reset(2);
    });
    // Let the pending stop() settle against the array it can no longer fit in.
    await act(async () => {});

    expect(result.current.clips).toEqual([null, null]);
  });

  it("abandons a recording still running when a new sitting starts", () => {
    const { result } = film();
    act(() => result.current.reset(2));
    act(() => result.current.begin(theme("griffith")));
    act(() => result.current.reset(2));

    expect(started[0].cancel).toHaveBeenCalled();
  });

  it("does nothing at all without a canvas to film", () => {
    const local = { current: null } as React.RefObject<HTMLVideoElement | null>;
    const remote = { current: null } as React.RefObject<HTMLVideoElement | null>;
    const { result } = renderHook(() =>
      useLiveFilm({ localVideo: local, remoteVideo: remote }),
    );

    act(() => result.current.begin(theme("griffith")));
    expect(started).toHaveLength(0);
  });

  it("ending without having begun is harmless", async () => {
    const { result } = film();
    act(() => result.current.reset(2));
    await act(async () => {
      result.current.end(0);
    });
    expect(result.current.clips).toEqual([null, null]);
  });

  it("abandons an unfinished recording when the booth goes away", () => {
    const { result, unmount } = film();
    act(() => result.current.reset(2));
    act(() => result.current.begin(theme("griffith")));
    unmount();

    expect(started[0].cancel).toHaveBeenCalled();
  });
});
