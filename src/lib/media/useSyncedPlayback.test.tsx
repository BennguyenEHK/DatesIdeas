import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSyncedPlayback } from "./useSyncedPlayback";
import type { PlayerHandle } from "./player";
import type { PeerMessage } from "@/lib/rtc/protocol";
import type { Film } from "./sync";

/** A YouTube film, which is what every test here is about unless it says so. */
const film = (videoId: string): Film => ({
  videoId,
  source: "youtube",
  durationSec: null,
});

/** Records what the sync layer asks of a player, and in what order. */
function fakePlayer(ready = true, acceptsRate = true) {
  const calls: string[] = [];
  let time = 0;
  const handle: PlayerHandle = {
    isReady: () => ready,
    load: (id, start) => {
      calls.push(`load:${id}@${start}`);
      time = start;
    },
    play: () => calls.push("play"),
    pause: () => calls.push("pause"),
    seek: (s) => {
      calls.push(`seek:${s}`);
      time = s;
    },
    nudge: (s) => {
      calls.push(`nudge:${s}`);
      time = s;
    },
    setRate: (rate) => {
      calls.push(`rate:${rate}`);
      return acceptsRate;
    },
    currentTime: () => time,
    setVolume: (v) => calls.push(`volume:${v}`),
  };
  return {
    handle,
    calls,
    setTime: (t: number) => {
      time = t;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSyncedPlayback", () => {
  it("cues a loaded video without starting it", () => {
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    act(() => void vi.advanceTimersByTime(2100));

    expect(p.calls.some((c) => c.startsWith("load:dQw4w9WgXcQ"))).toBe(true);
    expect(p.calls).not.toContain("play");
  });

  it("applies pause before seeking, never after", () => {
    // YouTube's seekTo starts playback when a video is merely cued rather than
    // paused. Seeking first therefore blips the audio on a paused resync; this
    // ordering is the whole reason it does not.
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    act(() => void vi.advanceTimersByTime(2100));
    // The peer resynced to a different point while still paused.
    p.setTime(0);
    act(() =>
      result.current.accept({
        t: "media",
        source: "youtube",
        durationSec: null,
        videoId: "dQw4w9WgXcQ",
        positionSec: 90,
        playing: false,
        atSharedTime: Date.now(),
      } satisfies PeerMessage),
    );
    act(() => void vi.advanceTimersByTime(2100));

    const seeks = p.calls
      .map((c, i) => (c.startsWith("seek:") ? i : -1))
      .filter((i) => i >= 0);
    expect(seeks.length).toBeGreaterThan(0);
    // The invariant, stated per seek rather than across the whole run: the
    // state is always applied immediately before the seek, never after it.
    for (const i of seeks) expect(p.calls[i - 1]).toBe("pause");
    expect(p.calls).not.toContain("play");
  });

  it("reaches the player without waiting for the timer", () => {
    // The fix for a song arriving late. A play that waits on a 2s tick is not
    // a delay on a song, it is a different verse.
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    const before = p.calls.length;
    act(() =>
      result.current.accept({
        t: "media",
        source: "youtube",
        durationSec: null,
        videoId: "dQw4w9WgXcQ",
        positionSec: 0,
        playing: true,
        atSharedTime: Date.now(),
      } satisfies PeerMessage),
    );
    // No timer advanced at all.
    expect(p.calls.length).toBeGreaterThan(before);
    expect(p.calls).toContain("play");
  });

  it("never sends the local music level to the peer", () => {
    // Loudness is this side's alone. If it ever entered the shared state, one
    // person reaching for their own volume would move the other's.
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );
    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    act(() => void vi.advanceTimersByTime(11_000));
    expect(JSON.stringify(sent)).not.toContain("volume");
    expect(p.calls.some((c) => c.startsWith("volume:"))).toBe(false);
  });

  it("uses the listening offset only for its local player", () => {
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}, 0.35),
    );

    act(() =>
      result.current.accept({
        t: "media",
        source: "youtube",
        durationSec: null,
        videoId: "dQw4w9WgXcQ",
        positionSec: 10,
        playing: false,
        atSharedTime: Date.now(),
      } satisfies PeerMessage),
    );
    expect(p.calls).toContain("load:dQw4w9WgXcQ@9.65");

    p.setTime(0);
    act(() =>
      result.current.accept({
        t: "media",
        source: "youtube",
        durationSec: null,
        videoId: "dQw4w9WgXcQ",
        positionSec: 11,
        playing: false,
        atSharedTime: Date.now(),
      } satisfies PeerMessage),
    );
    expect(p.calls).toContain("seek:10.65");
  });

  it("reapplies a changed listening offset without waiting for drift correction", () => {
    const p = fakePlayer();
    const { result, rerender } = renderHook(
      ({ offsetSec }) => useSyncedPlayback(p.handle, null, () => {}, offsetSec),
      { initialProps: { offsetSec: 0.3 } },
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 10));
    const before = p.calls.length;
    act(() => rerender({ offsetSec: 0.8 }));

    expect(p.calls.length).toBeGreaterThan(before);
    // A nudge, not a seek. Half a second is a turn changing hands, and the
    // player is certainly holding that much either side of where it is.
    expect(p.calls).toContain("nudge:9.2");
  });

  it("stamps a local pause back at the true shared position", () => {
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m), 0.35),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 10));
    p.setTime(9.65);
    act(() => result.current.playPause());
    p.setTime(9.65);
    act(() => result.current.playPause());

    expect(sent.at(-1)).toMatchObject({ positionSec: 10, playing: false });
  });

  it("never sends the local listening offset to the peer", () => {
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m), 0.347),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 10));
    p.setTime(10.5);
    act(() => result.current.playPause());
    act(() => result.current.resync());
    act(() => void vi.advanceTimersByTime(5_000));

    expect(JSON.stringify(sent)).not.toContain("0.347");
  });

  it("does not touch a player that is not ready", () => {
    const p = fakePlayer(false);
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );
    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    act(() => void vi.advanceTimersByTime(5000));
    expect(p.calls).toEqual([]);
  });

  it("tells the peer whenever this side changes something", () => {
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    expect(sent.at(-1)).toMatchObject({ t: "media", videoId: "dQw4w9WgXcQ" });

    act(() => result.current.playPause());
    expect(sent.at(-1)).toMatchObject({ t: "media", playing: true });
  });

  it("adopts the peer's state without echoing it back", () => {
    // Echoing an accepted state would have the two sides answering each other
    // forever, each restating what the other just said.
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );

    act(() =>
      result.current.accept({
        t: "media",
        source: "youtube",
        durationSec: null,
        videoId: "abc12345678",
        positionSec: 5,
        playing: true,
        atSharedTime: Date.now(),
      } satisfies PeerMessage),
    );

    expect(result.current.videoId).toBe("abc12345678");
    expect(result.current.playing).toBe(true);
    expect(sent).toEqual([]);
  });

  it("ignores messages that are not about media", () => {
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );
    act(() =>
      result.current.accept({ t: "meme", id: "heart", showAt: 1 } satisfies PeerMessage),
    );
    expect(result.current.videoId).toBeNull();
  });

  it("keeps restating the state so a peer can catch up", () => {
    // The heartbeat is what makes a whole-state protocol self-healing: someone
    // who missed a message, or sat through an ad, is pulled back in step
    // without anyone having to notice there was a problem.
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    const afterLoad = sent.length;
    act(() => void vi.advanceTimersByTime(11_000));
    expect(sent.length).toBeGreaterThan(afterLoad);
  });

  it("stops restating once the song is cleared", () => {
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    act(() => result.current.clear());
    const afterClear = sent.length;
    act(() => void vi.advanceTimersByTime(11_000));
    expect(sent.length).toBe(afterClear);
  });
});

describe("reporting how long a local film is", () => {
  const localFilm = { videoId: "Inception.mp4", source: "local" as const, durationSec: null };

  it("tells the peer once the browser knows the length", () => {
    // Measured only after the file is opened, so it cannot travel with the
    // load. Without this the other side has nothing to compare against and
    // the mismatch warning could never fire.
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );
    act(() => result.current.load(localFilm));
    act(() => result.current.reportDuration(7402));
    expect(sent.at(-1)).toMatchObject({ durationSec: 7402, source: "local" });
  });

  it("ramps a small error without moving the playhead, then returns to normal speed", () => {
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    p.setTime(0.18);
    act(() =>
      result.current.accept({
        t: "media",
        source: "youtube",
        durationSec: null,
        videoId: "dQw4w9WgXcQ",
        positionSec: 0,
        playing: true,
        atSharedTime: Date.now(),
      } satisfies PeerMessage),
    );

    expect(p.calls).toContain("rate:0.97");
    expect(p.calls.some((call) => call.startsWith("seek:"))).toBe(false);
    expect(p.calls.some((call) => call.startsWith("nudge:"))).toBe(false);
    act(() => void vi.advanceTimersByTime(6_000));
    expect(p.calls).toContain("rate:1");
  });

  it("nudges a small error when the player cannot ramp", () => {
    const p = fakePlayer(true, false);
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    p.setTime(0.18);
    act(() =>
      result.current.accept({
        t: "media", source: "youtube", durationSec: null, videoId: "dQw4w9WgXcQ",
        positionSec: 0, playing: true, atSharedTime: Date.now(),
      } satisfies PeerMessage),
    );

    expect(p.calls.some((call) => call.startsWith("nudge:"))).toBe(true);
    expect(p.calls.some((call) => call.startsWith("seek:"))).toBe(false);
  });

  it("seeks an error far too large to have been buffered", () => {
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    // Well past NUDGE_LIMIT_SEC: a stall or a late join, not a turn change.
    p.setTime(45);
    act(() =>
      result.current.accept({
        t: "media", source: "youtube", durationSec: null, videoId: "dQw4w9WgXcQ",
        positionSec: 0, playing: true, atSharedTime: Date.now(),
      } satisfies PeerMessage),
    );

    expect(p.calls.some((call) => call.startsWith("seek:"))).toBe(true);
  });

  it("does not seek from the correction interval while a ramp is active", () => {
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    p.setTime(0.18);
    act(() =>
      result.current.accept({
        t: "media", source: "youtube", durationSec: null, videoId: "dQw4w9WgXcQ",
        positionSec: 0, playing: true, atSharedTime: Date.now(),
      } satisfies PeerMessage),
    );
    const afterRampStarts = p.calls.length;
    act(() => void vi.advanceTimersByTime(2_000));
    expect(p.calls.slice(afterRampStarts)).not.toContainEqual(expect.stringMatching(/^seek:/));
  });

  it("does not move the film while doing it", () => {
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );
    act(() => result.current.load(localFilm, 120));
    act(() => result.current.reportDuration(7402));
    expect(sent.at(-1)).toMatchObject({ positionSec: 120, playing: false });
  });

  it("stays quiet when this side did not choose the film", () => {
    // The one that matters. Both people open their own copy, and both measure
    // a slightly different length. If each reported its own, they would
    // overwrite each other forever, one message per side, without end.
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );
    act(() =>
      result.current.accept({
        t: "media",
        videoId: "Inception.mp4",
        source: "local",
        durationSec: 7402,
        positionSec: 0,
        playing: false,
        atSharedTime: Date.now(),
      } satisfies PeerMessage),
    );
    act(() => result.current.reportDuration(7400));
    expect(sent).toEqual([]);
    // And the length it was told is the one it keeps, to compare against.
    expect(result.current.film.durationSec).toBe(7402);
  });

  it("reports a length only once", () => {
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );
    act(() => result.current.load(localFilm));
    act(() => result.current.reportDuration(7402));
    const after = sent.length;
    act(() => result.current.reportDuration(7402));
    expect(sent.length).toBe(after);
  });

  it("says nothing when there is no film", () => {
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );
    act(() => result.current.reportDuration(7402));
    expect(sent).toEqual([]);
  });
});

describe("a turn changing hands on a player that cannot ramp", () => {
  /**
   * The case this whole mechanism exists for, and the one easiest to lose.
   *
   * When the singing turn changes the offset moves by roughly the latency --
   * a couple of hundred milliseconds. That is too large for a ramp to absorb
   * inside MAX_RAMP_SEC, so rampPlan returns null for it. Routing the "no
   * plan" branch to seek() therefore sent exactly these corrections back to
   * the stalling seek, while the ramp quietly handled only the corrections
   * nobody was complaining about.
   */
  it("nudges rather than seeks when the delay changes by a turn's worth", () => {
    // acceptsRate false is YouTube: its API rounds any rate it does not
    // support back towards 1, so it refuses rather than pretend.
    const p = fakePlayer(true, false);
    const view = renderHook(
      ({ offset }) => useSyncedPlayback(p.handle, null, () => {}, offset),
      { initialProps: { offset: 0 } },
    );

    act(() => view.result.current.load(film("dQw4w9WgXcQ"), 30));
    p.calls.length = 0;

    // Their turn to sing: this side's music drops 250ms behind.
    act(() => view.rerender({ offset: 0.25 }));

    expect(p.calls.some((c) => c.startsWith("nudge:"))).toBe(true);
    expect(p.calls.some((c) => c.startsWith("seek:"))).toBe(false);
  });

  it("still seeks for a correction too large to have been buffered", () => {
    const p = fakePlayer(true, false);
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );

    act(() => result.current.load(film("dQw4w9WgXcQ"), 0));
    p.calls.length = 0;
    // Three quarters of a minute adrift is a stall, not a turn change.
    p.setTime(45);
    act(() => void vi.advanceTimersByTime(2100));

    expect(p.calls.some((c) => c.startsWith("seek:"))).toBe(true);
  });
});
