import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTrackTransfer } from "./useTrackTransfer";
import type { PeerMessage } from "@/lib/rtc/protocol";

/**
 * Sending a track to someone who may not be there.
 *
 * The interesting cases are all about a `false` from sendFileChunk meaning two
 * opposite things -- a buffer that will drain, and a channel that never will.
 */
function setup(options: {
  chunkAccepted?: (attempt: number) => boolean;
  channelOpen?: () => boolean;
} = {}) {
  const sent: ArrayBuffer[] = [];
  const messages: PeerMessage[] = [];
  let attempt = 0;

  const sendFileChunk = vi.fn((chunk: ArrayBuffer) => {
    attempt += 1;
    const ok = options.chunkAccepted ? options.chunkAccepted(attempt) : true;
    if (ok) sent.push(chunk);
    return ok;
  });

  const view = renderHook(() =>
    useTrackTransfer({
      sendMessage: (m) => messages.push(m),
      sendFileChunk,
      fileChannelOpen: options.channelOpen ?? (() => true),
      onFileChunk: () => () => {},
      onReceived: () => {},
    }),
  );

  return { view, sent, messages, sendFileChunk, attempts: () => attempt };
}

function track(bytes = 4096) {
  return {
    requestId: "req-1",
    media: new ArrayBuffer(bytes),
    contentType: "video/mp4",
    title: "Country Roads",
    durationSec: 197,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("sendTrack", () => {
  it("sends the whole track when the other side is there", async () => {
    const t = setup();
    await act(async () => {
      await t.view.result.current.sendTrack(track());
    });
    expect(t.sent.length).toBeGreaterThan(0);
    expect(t.messages.at(0)?.t).toBe("track-meta");
    expect(t.messages.at(-1)?.t).toBe("track-done");
  });

  it("THE BUG: gives up instead of retrying forever when nobody is connected", async () => {
    // With no peer the data channel is never open, so sendFileChunk answers
    // false every time. The old loop read that as backpressure and waited for
    // it to clear -- twenty times a second, for as long as the page stayed
    // open, for every link pasted while alone.
    vi.useFakeTimers();
    const t = setup({ chunkAccepted: () => false, channelOpen: () => false });

    let settled = false;
    const pending = t.view.result.current
      .sendTrack(track())
      .then(() => {
        settled = true;
      });

    // Far longer than any real backpressure, and long enough that an unbounded
    // loop would have run thousands of times by now.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    await pending;

    expect(settled).toBe(true);
  });

  it("does not announce a track it knows it cannot send", async () => {
    // The announcement is a promise that bytes are coming. Making it to nobody
    // is harmless, but making it and then never delivering is what leaves a
    // peer's progress bar filling toward a total that never arrives.
    vi.useFakeTimers();
    const t = setup({ chunkAccepted: () => false, channelOpen: () => false });
    await act(async () => {
      const p = t.view.result.current.sendTrack(track());
      await vi.advanceTimersByTimeAsync(120_000);
      await p;
    });
    expect(t.messages).toEqual([]);
    expect(t.sendFileChunk).not.toHaveBeenCalled();
  });

  it("still waits out real backpressure rather than treating it as a dead peer", async () => {
    // The channel is open the whole time; it just refuses the first few
    // attempts. Giving up here would break sending over a slow connection,
    // which is the case the retry loop exists for.
    vi.useFakeTimers();
    const t = setup({ chunkAccepted: (n) => n > 3, channelOpen: () => true });
    await act(async () => {
      const p = t.view.result.current.sendTrack(track());
      await vi.advanceTimersByTimeAsync(5_000);
      await p;
    });
    expect(t.attempts()).toBeGreaterThan(3);
    expect(t.sent.length).toBeGreaterThan(0);
    expect(t.messages.at(-1)?.t).toBe("track-done");
  });

  it("stops mid-track if the other person disappears part way through", async () => {
    vi.useFakeTimers();
    let open = true;
    const t = setup({
      chunkAccepted: (n) => {
        if (n > 1) open = false;
        return n <= 1;
      },
      channelOpen: () => open,
    });
    await act(async () => {
      const p = t.view.result.current.sendTrack(track(64 * 1024));
      await vi.advanceTimersByTimeAsync(120_000);
      await p;
    });
    // It announced the track before the peer left, so track-meta is expected --
    // but it must not claim the transfer finished.
    expect(t.messages.some((m) => m.t === "track-done")).toBe(false);
  });
});
