import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useTrackTransfer,
  type ReceivedTrack,
  type TrackBucket,
} from "./useTrackTransfer";
import type { PeerMessage } from "@/lib/rtc/protocol";
import { CHUNK_BYTES } from "@/lib/rtc/fileChannel";
import { EMPTY_LINK, type LinkSnapshot } from "@/lib/rtc/linkSnapshot";
import { TRANSFER_UNKNOWN_KBPS } from "./transferPacer";

/**
 * Sending a track to someone who may not be there.
 *
 * The interesting cases are all about a `false` from sendFileChunk meaning two
 * opposite things -- a buffer that will drain, and a channel that never will.
 */
/**
 * A bucket that has no room: no slot, no upload, nothing to download.
 *
 * The default, so the tests of the peer-to-peer path never touch a network and
 * never depend on what the real module does.
 */
function emptyBucket(): TrackBucket {
  return {
    requestTrackSlot: vi.fn(async () => null),
    uploadTrack: vi.fn(async () => false),
    downloadTrack: vi.fn(async () => null),
  };
}

function setup(options: {
  chunkAccepted?: (attempt: number) => boolean;
  channelOpen?: () => boolean;
  linkSnapshot?: () => LinkSnapshot;
  bucket?: TrackBucket;
} = {}) {
  const sent: ArrayBuffer[] = [];
  /** When each accepted chunk went, by the (possibly fake) clock. */
  const sentAt: number[] = [];
  const messages: PeerMessage[] = [];
  const received: ReceivedTrack[] = [];
  /** Every call to holdCamera, in order. */
  const holds: boolean[] = [];
  const bucket = options.bucket ?? emptyBucket();
  let deliver: (chunk: ArrayBuffer) => void = () => {};
  let attempt = 0;

  const sendFileChunk = vi.fn((chunk: ArrayBuffer) => {
    attempt += 1;
    const ok = options.chunkAccepted ? options.chunkAccepted(attempt) : true;
    if (ok) {
      sent.push(chunk);
      sentAt.push(Date.now());
    }
    return ok;
  });

  const view = renderHook(() =>
    useTrackTransfer({
      sendMessage: (m) => messages.push(m),
      sendFileChunk,
      fileChannelOpen: options.channelOpen ?? (() => true),
      onFileChunk: (handler) => {
        deliver = handler;
        return () => {
          deliver = () => {};
        };
      },
      onReceived: (t) => received.push(t),
      linkSnapshot: options.linkSnapshot,
      roomCode: "ROOM1",
      holdCamera: (on) => holds.push(on),
      bucket,
    }),
  );

  return {
    view,
    holds,
    bucket,
    sent,
    sentAt,
    messages,
    received,
    sendFileChunk,
    attempts: () => attempt,
    deliver: (chunk: ArrayBuffer) => deliver(chunk),
  };
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

describe("receiving a track", () => {
  /** The announcement the sender puts on the control channel before any bytes. */
  function announce(t: ReturnType<typeof setup>, bytes: number) {
    act(() => {
      t.view.result.current.handleMessage({
        t: "track-meta",
        requestId: "req-1",
        title: "Country Roads",
        durationSec: 197,
        bytes,
        chunks: Math.ceil(bytes / CHUNK_BYTES),
      });
    });
  }

  it("THE RACE: keeps taking bytes that are still arriving after track-done", async () => {
    // track-done travels on the control channel and the bytes on the file
    // channel, and those are two independent SCTP streams with no ordering
    // between them. One short message on an idle stream overtakes megabytes
    // still draining out of a busy one -- on a relayed connection, by minutes.
    //
    // Treating the marker as proof that the rest was lost throws away the
    // assembler, and every chunk that then arrives has nowhere to go. The song
    // can never land, however long the other person waits.
    vi.useFakeTimers();
    const total = CHUNK_BYTES * 3;
    const t = setup();
    announce(t, total);

    act(() => {
      t.deliver(new ArrayBuffer(CHUNK_BYTES));
    });

    // The overtaking marker.
    act(() => {
      t.view.result.current.handleMessage({ t: "track-done", requestId: "req-1" });
    });

    // The rest of the bytes, still on their way out of the sender's queue.
    act(() => {
      t.deliver(new ArrayBuffer(CHUNK_BYTES));
      t.deliver(new ArrayBuffer(CHUNK_BYTES));
    });

    expect(t.received).toHaveLength(1);
    expect(t.received[0]?.title).toBe("Country Roads");
    expect(t.view.result.current.error).toBeNull();
    expect(t.view.result.current.incoming).toBeNull();
  });

  it("still reports a transfer that goes quiet after track-done", async () => {
    // Bytes on one stream arrive in order, so once they stop for long enough
    // with the sender finished, they have stopped for good. That silence -- not
    // the marker -- is what says the song was lost.
    vi.useFakeTimers();
    const t = setup();
    announce(t, CHUNK_BYTES * 3);
    act(() => {
      t.deliver(new ArrayBuffer(CHUNK_BYTES));
      t.view.result.current.handleMessage({ t: "track-done", requestId: "req-1" });
    });

    expect(t.view.result.current.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(t.view.result.current.error).toMatch(/did not arrive intact/i);
    expect(t.view.result.current.incoming).toBeNull();
  });

  it("does not fail a transfer that is merely slow, before track-done", async () => {
    vi.useFakeTimers();
    const t = setup();
    announce(t, CHUNK_BYTES * 2);
    act(() => {
      t.deliver(new ArrayBuffer(CHUNK_BYTES));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(t.view.result.current.error).toBeNull();
    expect(t.view.result.current.incoming?.receivedBytes).toBe(CHUNK_BYTES);
  });

  it("a new announcement cancels the previous transfer's countdown", async () => {
    vi.useFakeTimers();
    const t = setup();
    announce(t, CHUNK_BYTES * 3);
    act(() => {
      t.deliver(new ArrayBuffer(CHUNK_BYTES));
      t.view.result.current.handleMessage({ t: "track-done", requestId: "req-1" });
    });
    announce(t, CHUNK_BYTES);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // The countdown belonged to the abandoned transfer; firing it here would
    // condemn the new one before a single byte of it had a chance to arrive.
    expect(t.view.result.current.error).toBeNull();
  });
});

describe("sharing the link with the call", () => {
  /** Ten chunks: small enough to be quick, long enough for pacing to show. */
  const TEN_CHUNKS = 10 * CHUNK_BYTES;

  it("paces the song to its share of the link rather than sending flat out", async () => {
    // The field report: a ~700 kbps relay, and the song sent as fast as the
    // channel would take it. The voice broke up and the sync ping sat 14.7 s
    // behind the file. At 30% the song gets 210 kbps, so 160 KB is ~6 s.
    vi.useFakeTimers();
    const t = setup({
      linkSnapshot: () => ({ ...EMPTY_LINK, outgoingKbps: 700 }),
    });
    const start = Date.now();
    let outcome;
    await act(async () => {
      const p = t.view.result.current.sendTrack(track(TEN_CHUNKS));
      await vi.advanceTimersByTimeAsync(60_000);
      outcome = await p;
    });

    expect(outcome).toBe("sent");
    expect(t.sent).toHaveLength(10);
    const expectedMs = (TEN_CHUNKS * 8) / 210;
    const tookMs = (t.sentAt.at(-1) ?? Number.NaN) - start;
    expect(tookMs).toBeGreaterThanOrEqual(expectedMs * 0.75);
    expect(tookMs).toBeLessThanOrEqual(expectedMs * 1.25);
  });

  it("sends nothing while the voice is jittering, and resumes once it recovers", async () => {
    vi.useFakeTimers();
    let snapshot: LinkSnapshot = {
      ...EMPTY_LINK,
      outgoingKbps: 700,
      theirJitterMs: 800,
    };
    const t = setup({ linkSnapshot: () => snapshot });
    let outcome;
    await act(async () => {
      const p = t.view.result.current.sendTrack(track(TEN_CHUNKS));

      await vi.advanceTimersByTimeAsync(30_000);
      // Held for the whole of it: the voice outranks the song.
      expect(t.sendFileChunk).not.toHaveBeenCalled();
      expect(t.messages.some((m) => m.t === "track-done")).toBe(false);

      snapshot = { ...snapshot, theirJitterMs: 20 };
      await vi.advanceTimersByTimeAsync(60_000);
      outcome = await p;
    });

    expect(outcome).toBe("sent");
    expect(t.sent).toHaveLength(10);
    expect(t.messages.at(-1)?.t).toBe("track-done");
  });

  it("keeps sending through heavy loss, because loss alone is not the song's doing", async () => {
    // The field report: on lossy Wi-Fi the old rule held the song nearly all the
    // time, and it crept from 7% to 10% in three minutes.
    vi.useFakeTimers();
    const t = setup({
      linkSnapshot: () => ({ ...EMPTY_LINK, outgoingKbps: 700, theirLossPct: 12 }),
    });
    let outcome;
    await act(async () => {
      const p = t.view.result.current.sendTrack(track(TEN_CHUNKS));
      await vi.advanceTimersByTimeAsync(30_000);
      outcome = await p;
    });

    expect(outcome).toBe("sent");
    expect(t.sent).toHaveLength(10);
  });

  it("still finishes with no link figures at all, at the relay-sized guess", async () => {
    vi.useFakeTimers();
    const t = setup();
    const start = Date.now();
    let outcome;
    await act(async () => {
      const p = t.view.result.current.sendTrack(track(TEN_CHUNKS));
      await vi.advanceTimersByTimeAsync(60_000);
      outcome = await p;
    });

    expect(outcome).toBe("sent");
    expect(t.sent).toHaveLength(10);
    const expectedMs = (TEN_CHUNKS * 8) / TRANSFER_UNKNOWN_KBPS;
    const tookMs = (t.sentAt.at(-1) ?? Number.NaN) - start;
    expect(tookMs).toBeGreaterThanOrEqual(expectedMs * 0.75);
    expect(tookMs).toBeLessThanOrEqual(expectedMs * 1.25);
  });

  it("notices the other person leaving while the song is held", async () => {
    vi.useFakeTimers();
    let open = true;
    const t = setup({
      channelOpen: () => open,
      linkSnapshot: () => ({ ...EMPTY_LINK, theirJitterMs: 2000 }),
    });
    let outcome;
    await act(async () => {
      const p = t.view.result.current.sendTrack(track(TEN_CHUNKS));
      await vi.advanceTimersByTimeAsync(5_000);
      open = false;
      // A dropped channel is waited for, so the verdict comes after the wait.
      await vi.advanceTimersByTimeAsync(70_000);
      outcome = await p;
    });

    expect(outcome).toBe("peer-left");
    expect(t.sendFileChunk).not.toHaveBeenCalled();
  });
});

/** A track whose every chunk is filled with its own number, starting at 1. */
function numberedTrack(chunks: number) {
  const media = new Uint8Array(chunks * CHUNK_BYTES);
  for (let i = 0; i < chunks; i += 1) {
    media.fill(i + 1, i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
  }
  return { ...track(), media: media.buffer };
}

/** The number each sent chunk was filled with, in the order they went. */
function sentNumbers(sent: ArrayBuffer[]): number[] {
  return sent.map((chunk) => new Uint8Array(chunk)[0]);
}

describe("sending through the bucket", () => {
  const BYTES = 1000;

  function workingBucket(
    upload: TrackBucket["uploadTrack"] = async () => true,
  ): TrackBucket {
    return {
      requestTrackSlot: vi.fn(async () => ({
        uploadUrl: "https://bucket.example/up",
        downloadUrl: "https://bucket.example/down",
      })),
      uploadTrack: vi.fn(upload),
      downloadTrack: vi.fn(async () => null),
    };
  }

  it("sends through the bucket: slot, upload with throttled track-progress, then track-url", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const bucket = workingBucket(async (_url, _media, onProgress) => {
      onProgress(100);
      // Inside the half second: swallowed.
      vi.setSystemTime(start + 100);
      onProgress(200);
      vi.setSystemTime(start + 600);
      onProgress(600);
      onProgress(700);
      return true;
    });
    const t = setup({ bucket });

    let outcome;
    await act(async () => {
      outcome = await t.view.result.current.sendTrack(track(BYTES));
    });

    expect(outcome).toBe("sent");
    expect(bucket.requestTrackSlot).toHaveBeenCalledWith("ROOM1", BYTES);
    expect(bucket.uploadTrack).toHaveBeenCalledWith(
      "https://bucket.example/up",
      expect.any(ArrayBuffer),
      expect.any(Function),
    );
    expect(t.messages).toEqual([
      { t: "track-progress", requestId: "req-1", sentBytes: 100, bytes: BYTES },
      { t: "track-progress", requestId: "req-1", sentBytes: 600, bytes: BYTES },
      // The final report, so the bar reaches the halfway mark.
      {
        t: "track-progress",
        requestId: "req-1",
        sentBytes: BYTES,
        bytes: BYTES,
      },
      {
        t: "track-url",
        requestId: "req-1",
        url: "https://bucket.example/down",
        title: "Country Roads",
        durationSec: 197,
        bytes: BYTES,
      },
    ]);
    expect(t.sendFileChunk).not.toHaveBeenCalled();
  });

  it("falls back to peer-to-peer when no slot is available", async () => {
    const t = setup();
    let outcome;
    await act(async () => {
      outcome = await t.view.result.current.sendTrack(track());
    });

    expect(outcome).toBe("sent");
    expect(t.bucket.uploadTrack).not.toHaveBeenCalled();
    expect(t.messages.at(0)?.t).toBe("track-meta");
    expect(t.messages.at(-1)?.t).toBe("track-done");
    expect(t.messages.some((m) => m.t === "track-url")).toBe(false);
    expect(t.sent.length).toBeGreaterThan(0);
  });

  it("falls back to peer-to-peer when the upload fails", async () => {
    const bucket = workingBucket(async () => false);
    const t = setup({ bucket });
    let outcome;
    await act(async () => {
      outcome = await t.view.result.current.sendTrack(track());
    });

    expect(outcome).toBe("sent");
    expect(bucket.uploadTrack).toHaveBeenCalledTimes(1);
    expect(t.messages.at(0)?.t).toBe("track-meta");
    expect(t.messages.at(-1)?.t).toBe("track-done");
    expect(t.messages.some((m) => m.t === "track-url")).toBe(false);
    expect(t.sent.length).toBeGreaterThan(0);
  });

  it("holds the camera for the whole send and releases it on success and on failure", async () => {
    let heldDuringUpload: boolean[] = [];
    let holds: boolean[] = [];
    const bucket = workingBucket(async () => {
      heldDuringUpload = [...holds];
      return true;
    });
    const ok = setup({ bucket });
    holds = ok.holds;
    await act(async () => {
      await ok.view.result.current.sendTrack(track(BYTES));
    });
    // Already held while the upload ran, and let go once it was over.
    expect(heldDuringUpload).toEqual([true]);
    expect(ok.holds).toEqual([true, false]);

    // And a send that ends badly gives the camera back all the same.
    vi.useFakeTimers();
    const failed = setup({ chunkAccepted: () => false, channelOpen: () => false });
    let outcome;
    await act(async () => {
      const p = failed.view.result.current.sendTrack(track());
      await vi.advanceTimersByTimeAsync(120_000);
      outcome = await p;
    });
    expect(outcome).toBe("no-peer");
    expect(failed.holds).toEqual([true, false]);
  });

  it("sender starts the peer-to-peer send after track-url-failed", async () => {
    vi.useFakeTimers();
    const bucket = workingBucket();
    const t = setup({ bucket });
    await act(async () => {
      await t.view.result.current.sendTrack(track(BYTES));
    });
    expect(t.sent).toHaveLength(0);
    expect(t.holds).toEqual([true, false]);

    // Not the request it last handed over by link: nothing to send.
    await act(async () => {
      t.view.result.current.handleMessage({
        t: "track-url-failed",
        requestId: "other",
      });
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(t.sent).toHaveLength(0);

    await act(async () => {
      t.view.result.current.handleMessage({
        t: "track-url-failed",
        requestId: "req-1",
      });
      // Held from the moment it starts, before a single byte moves.
      expect(t.holds).toEqual([true, false, true]);
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const afterUrl = t.messages.filter((m) => m.t !== "track-progress");
    expect(afterUrl.map((m) => m.t)).toEqual([
      "track-url",
      "track-meta",
      "track-done",
    ]);
    expect(t.sent.length).toBeGreaterThan(0);
    expect(t.holds).toEqual([true, false, true, false]);

    // A second complaint about the same request does not send it a third time.
    const sentBefore = t.sent.length;
    await act(async () => {
      t.view.result.current.handleMessage({
        t: "track-url-failed",
        requestId: "req-1",
      });
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(t.sent).toHaveLength(sentBefore);
  });
});

describe("receiving through the bucket", () => {
  function offer(
    overrides: Partial<Extract<PeerMessage, { t: "track-url" }>> = {},
  ) {
    return {
      t: "track-url" as const,
      requestId: "req-1",
      url: "https://bucket.example/down",
      title: "Country Roads",
      durationSec: 197,
      bytes: 2000,
      ...overrides,
    };
  }

  it("receiver downloads a track-url and calls onReceived with the bytes", async () => {
    const bucket = emptyBucket();
    bucket.downloadTrack = vi.fn(
      async () => new Uint8Array(2000).fill(7).buffer,
    );
    const t = setup({ bucket });

    await act(async () => {
      t.view.result.current.handleMessage(offer());
    });

    expect(bucket.downloadTrack).toHaveBeenCalledWith(
      "https://bucket.example/down",
      2000,
      expect.any(Function),
    );
    expect(t.received).toHaveLength(1);
    expect(t.received[0]?.title).toBe("Country Roads");
    expect(t.received[0]?.durationSec).toBe(197);
    expect(t.received[0]?.requestId).toBe("req-1");
    expect(t.received[0]?.media.size).toBe(2000);
    expect(t.received[0]?.media.type).toBe("video/mp4");
    expect(t.view.result.current.incoming).toBeNull();
    expect(t.view.result.current.error).toBeNull();
  });

  it("receiver reports track-url-failed when the download fails", async () => {
    const t = setup();

    await act(async () => {
      t.view.result.current.handleMessage(offer());
    });

    expect(t.messages).toEqual([{ t: "track-url-failed", requestId: "req-1" }]);
    expect(t.received).toHaveLength(0);
    // The bar stays up: the song is about to arrive the other way.
    expect(t.view.result.current.incoming).toEqual({
      receivedBytes: 1000,
      expectedBytes: 2000,
    });
  });

  it("treats a download of the wrong length as a failed one", async () => {
    const bucket = emptyBucket();
    bucket.downloadTrack = vi.fn(async () => new ArrayBuffer(1999));
    const t = setup({ bucket });

    await act(async () => {
      t.view.result.current.handleMessage(offer());
    });

    expect(t.messages).toEqual([{ t: "track-url-failed", requestId: "req-1" }]);
    expect(t.received).toHaveLength(0);
  });

  it("receiver progress runs through upload then download monotonically", async () => {
    const bucket = emptyBucket();
    let finish: (buffer: ArrayBuffer) => void = () => {};
    let report: (receivedBytes: number) => void = () => {};
    bucket.downloadTrack = vi.fn(
      (_url, _bytes, onProgress) =>
        new Promise<ArrayBuffer | null>((resolve) => {
          report = onProgress;
          finish = resolve;
        }),
    );
    const t = setup({ bucket });
    const seen: number[] = [];
    const look = () => {
      const now = t.view.result.current.incoming;
      if (now !== null) seen.push(now.receivedBytes);
      return now;
    };

    for (const sentBytes of [0, 500, 2000]) {
      act(() => {
        t.view.result.current.handleMessage({
          t: "track-progress",
          requestId: "req-1",
          sentBytes,
          bytes: 2000,
        });
      });
      expect(look()?.expectedBytes).toBe(2000);
    }
    expect(seen).toEqual([0, 250, 1000]);

    act(() => {
      t.view.result.current.handleMessage(offer());
    });
    look();
    for (const receivedBytes of [0, 600, 500, 2000]) {
      act(() => {
        report(receivedBytes);
      });
      look();
    }
    // A figure that stepped backwards (a retried part) never moves the bar back.
    expect(seen).toEqual([0, 250, 1000, 1000, 1000, 1300, 1300, 2000]);
    expect(seen.every((value, i) => i === 0 || value >= seen[i - 1])).toBe(true);

    await act(async () => {
      finish(new ArrayBuffer(2000));
    });
    expect(t.received).toHaveLength(1);
    expect(t.view.result.current.incoming).toBeNull();
  });

  it("ignores a track-url for a request that a newer one has replaced", async () => {
    const bucket = emptyBucket();
    bucket.downloadTrack = vi.fn(async () => new ArrayBuffer(2000));
    const t = setup({ bucket });

    await act(async () => {
      t.view.result.current.handleMessage({
        t: "track-progress",
        requestId: "old",
        sentBytes: 10,
        bytes: 2000,
      });
      t.view.result.current.handleMessage({
        t: "track-meta",
        requestId: "new",
        title: "New",
        durationSec: 1,
        bytes: CHUNK_BYTES,
        chunks: 1,
      });
      // The old upload finishing late.
      t.view.result.current.handleMessage(offer({ requestId: "old" }));
    });

    expect(bucket.downloadTrack).not.toHaveBeenCalled();
    expect(t.received).toHaveLength(0);
    expect(t.messages).toEqual([]);
  });
});

describe("a dropped file channel", () => {
  const SIX_CHUNKS = 6;

  /** Open, then shut as the fourth chunk is offered, until `reopen()`. */
  function droppingSetup() {
    let open = true;
    let reopened = false;
    const t = setup({
      channelOpen: () => open,
      chunkAccepted: (n) => {
        if (n === 4 && !reopened) open = false;
        return open;
      },
    });
    return {
      t,
      reopen: () => {
        open = true;
        reopened = true;
      },
    };
  }

  it("a file channel that drops and reopens resumes from the receiver's fromChunk", async () => {
    vi.useFakeTimers();
    const { t, reopen } = droppingSetup();
    let outcome;
    await act(async () => {
      const p = t.view.result.current.sendTrack(numberedTrack(SIX_CHUNKS));
      // Three chunks go, the fourth finds the channel gone, and the sender waits
      // rather than giving up.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(sentNumbers(t.sent)).toEqual([1, 2, 3]);
      expect(t.messages.some((m) => m.t === "track-done")).toBe(false);

      reopen();
      // The receiver only holds two of the three: the third died with the channel.
      t.view.result.current.handleMessage({
        t: "track-resume",
        requestId: "req-1",
        fromChunk: 2,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      outcome = await p;
    });

    expect(outcome).toBe("sent");
    expect(sentNumbers(t.sent)).toEqual([1, 2, 3, 3, 4, 5, 6]);
    // One announcement: the receiver was never told to start over.
    expect(t.messages.filter((m) => m.t === "track-meta")).toHaveLength(1);
    expect(t.messages.at(-1)?.t).toBe("track-done");
  });

  it("with no track-resume after reopening, the send restarts from chunk 0 with a new track-meta", async () => {
    vi.useFakeTimers();
    const { t, reopen } = droppingSetup();
    let outcome;
    await act(async () => {
      const p = t.view.result.current.sendTrack(numberedTrack(SIX_CHUNKS));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(sentNumbers(t.sent)).toEqual([1, 2, 3]);

      reopen();
      // Nothing from the receiver yet: it is given ten seconds, not five.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(sentNumbers(t.sent)).toEqual([1, 2, 3]);
      await vi.advanceTimersByTimeAsync(60_000);
      outcome = await p;
    });

    expect(outcome).toBe("sent");
    expect(sentNumbers(t.sent)).toEqual([1, 2, 3, 1, 2, 3, 4, 5, 6]);
    expect(t.messages.map((m) => m.t)).toEqual([
      "track-meta",
      "track-meta",
      "track-done",
    ]);
  });

  it("gives up with peer-left only after waiting a minute for the channel", async () => {
    vi.useFakeTimers();
    const { t } = droppingSetup();
    let settled = false;
    let outcome;
    await act(async () => {
      const p = t.view.result.current
        .sendTrack(numberedTrack(SIX_CHUNKS))
        .then((o) => {
          settled = true;
          outcome = o;
        });
      await vi.advanceTimersByTimeAsync(50_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(15_000);
      await p;
    });

    expect(outcome).toBe("peer-left");
    expect(t.view.result.current.error).toMatch(/dropped out/i);
    expect(t.holds).toEqual([true, false]);
  });

  it("the receiver keeps its partial song across a drop and asks to resume from what it holds", async () => {
    vi.useFakeTimers();
    let open = true;
    const t = setup({ channelOpen: () => open });
    act(() => {
      t.view.result.current.handleMessage({
        t: "track-meta",
        requestId: "req-1",
        title: "Country Roads",
        durationSec: 197,
        bytes: CHUNK_BYTES * 3,
        chunks: 3,
      });
    });
    const tick = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    await tick(600);
    act(() => {
      t.deliver(new ArrayBuffer(CHUNK_BYTES));
      t.deliver(new ArrayBuffer(CHUNK_BYTES));
    });
    open = false;
    await tick(5_000);

    // Nothing is thrown away while the channel is gone, and nothing is asked yet.
    expect(t.view.result.current.error).toBeNull();
    expect(t.view.result.current.incoming).toEqual({
      receivedBytes: CHUNK_BYTES * 2,
      expectedBytes: CHUNK_BYTES * 3,
    });
    expect(t.messages).toEqual([]);

    open = true;
    await tick(600);
    expect(t.messages).toEqual([
      { t: "track-resume", requestId: "req-1", fromChunk: 2 },
    ]);

    // And the chunk that follows completes the song it kept.
    act(() => {
      t.deliver(new ArrayBuffer(CHUNK_BYTES));
    });
    expect(t.received).toHaveLength(1);
    expect(t.received[0]?.media.size).toBe(CHUNK_BYTES * 3);
    expect(t.view.result.current.incoming).toBeNull();

    // With the song in, a later reconnect asks for nothing.
    open = false;
    await tick(600);
    open = true;
    await tick(600);
    expect(t.messages).toHaveLength(1);
  });
});
