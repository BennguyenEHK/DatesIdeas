import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerMessage } from "@/lib/rtc/protocol";
import {
  SINGING_QUIET_HOLD_MS,
  SINGING_SAMPLE_MS,
  useSingingTurn,
} from "./useSingingTurn";

let frame = new Uint8Array(256).fill(128);

class FakeAnalyser {
  fftSize = 256;

  getByteTimeDomainData(target: Uint8Array) {
    target.set(frame);
  }

  disconnect() {}
}

class FakeSource {
  connect() {}
  disconnect() {}
}

class FakeAudioContext {
  createMediaStreamSource() {
    return new FakeSource();
  }

  createAnalyser() {
    return new FakeAnalyser();
  }

  close() {
    return Promise.resolve();
  }
}

const stream = {} as MediaStream;

beforeEach(() => {
  vi.useFakeTimers();
  frame = new Uint8Array(256).fill(128);
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSingingTurn", () => {
  it("sends only settled loudness transitions", () => {
    const send = vi.fn<(m: PeerMessage) => void>();
    renderHook(() => useSingingTurn({ stream, send, enabled: true }));

    act(() => void vi.advanceTimersByTime(SINGING_SAMPLE_MS * 2));
    expect(send).not.toHaveBeenCalled();

    frame.fill(208);
    act(() => void vi.advanceTimersByTime(SINGING_SAMPLE_MS * 3));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ t: "singing", on: true });

    frame.fill(128);
    act(() =>
      void vi.advanceTimersByTime(SINGING_SAMPLE_MS + SINGING_QUIET_HOLD_MS),
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ t: "singing", on: false });
  });

  it("releases the peer on unmount and when disabled", () => {
    const send = vi.fn<(m: PeerMessage) => void>();
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useSingingTurn({ stream, send, enabled }),
      { initialProps: { enabled: true } },
    );

    frame.fill(208);
    act(() => void vi.advanceTimersByTime(SINGING_SAMPLE_MS));
    act(() => rerender({ enabled: false }));
    expect(send).toHaveBeenLastCalledWith({ t: "singing", on: false });

    act(() => rerender({ enabled: true }));
    act(() => void vi.advanceTimersByTime(SINGING_SAMPLE_MS));
    unmount();
    expect(send).toHaveBeenLastCalledWith({ t: "singing", on: false });
  });

  it("adopts singing messages and ignores every other protocol frame", () => {
    const { result } = renderHook(() =>
      useSingingTurn({ stream: null, send: () => {}, enabled: false }),
    );

    act(() => result.current.accept({ t: "singing", on: true }));
    expect(result.current.theirs).toBe(true);

    act(() =>
      result.current.accept({ t: "meme", id: "heart", showAt: 1 }),
    );
    expect(result.current.theirs).toBe(true);
  });

  it("stays false when Web Audio is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    const { result } = renderHook(() =>
      useSingingTurn({ stream, send: () => {}, enabled: true }),
    );

    expect(result.current.mine).toBe(false);
  });
});
