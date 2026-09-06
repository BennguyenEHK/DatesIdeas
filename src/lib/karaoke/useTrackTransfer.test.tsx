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
    let outcome;
    await act(async () => {
      outcome = await t.view.result.current.sendTrack(track());
    });
    expect(outcome).toBe("sent");
    expect(t.sent.length).toBeGreaterThan(0);
    expect(t.messages.at(0)?.t).toBe("track-meta");
    expect(t.messages.at(-1)?.t).toBe("track-done");
  });

  it("THE SILENCE: says a send failed instead of returning as if it worked", async () => {
    // The whole reason this was hard to diagnose. A song that loaded here and
    // never reached the other person looked, from this side, exactly like a
    // song that had been delivered -- so the only symptom was on their screen,
    // and nothing on either side said which step had not happened.
    vi.useFakeTimers();
    const t = setup({ chunkAccepted: () => false, channelOpen: () => false });
    let outcome;
    await act(async () => {
      const p = t.view.result.current.sendTrack(track());
      await vi.advanceTimersByTimeAsync(120_000);
      outcome = await p;
    });
    expect(outcome).toBe("no-peer");
    expect(t.view.result.current.error).toMatch(/could not be sent|did not reach/i);
  });

  it("reports a peer that vanished separately from one that was never there", async () => {
    vi.useFakeTimers();
    let open = true;
    const t = setup({
      chunkAccepted: (n) => {
        if (n > 1) open = false;
        return n <= 1;
      },
      channelOpen: () => open,
    });
    let outcome;
    await act(async () => {
      const p = t.view.result.current.sendTrack(track(64 * 1024));
      await vi.advanceTimersByTimeAsync(120_000);
      outcome = await p;
    });
    expect(outcome).toBe("peer-left");
  });

  it("survives the channel throwing mid-send rather than dying unhandled", async () => {
    // dc.send() throws when the channel closes under it. Uncaught, that became
    // an unhandled rejection: no message, no state change, nothing on screen.
    // The channel here still reports itself open, so the honest verdict is a
    // stall rather than a departure -- what matters is that it ends, and says so.
    vi.useFakeTimers();
    const t = setup({
      chunkAccepted: () => {
        throw new Error("InvalidStateError: RTCDataChannel is closed");
      },
    });
    let outcome;
    await act(async () => {
      const p = t.view.result.current.sendTrack(track());
      await vi.advanceTimersByTimeAsync(30_000);
      outcome = await p;
    });
    expect(outcome).toBe("stalled");
    expect(t.view.result.current.error).toBeTruthy();
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

  it("THE REGRESSION: waits for a channel that is still opening", async () => {
    // A data channel is not open the instant a peer appears, and a fetch can
    // finish inside that window. Checking once and giving up turns "still
    // connecting" into "nobody there", and the other person never receives the
    // song at all -- they are left watching a player that was never sent one.
    vi.useFakeTimers();
    let opens = 0;
    const t = setup({
      // Shut for the first second of asking, then open, as a real one does.
      channelOpen: () => ++opens > 5,
    });

    await act(async () => {
      const p = t.view.result.current.sendTrack(track());
      await vi.advanceTimersByTimeAsync(30_000);
      await p;
    });

    expect(t.messages.at(0)?.t).toBe("track-meta");
    expect(t.messages.at(-1)?.t).toBe("track-done");
    expect(t.sent.length).toBeGreaterThan(0);
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
