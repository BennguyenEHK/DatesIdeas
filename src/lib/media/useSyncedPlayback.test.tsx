import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSyncedPlayback } from "./useSyncedPlayback";
import type { PlayerHandle } from "./player";
import type { PeerMessage } from "@/lib/rtc/protocol";

/** Records what the sync layer asks of a player, and in what order. */
function fakePlayer(ready = true) {
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

    act(() => result.current.load("dQw4w9WgXcQ", 0));
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

    act(() => result.current.load("dQw4w9WgXcQ", 0));
    act(() => void vi.advanceTimersByTime(2100));
    // The peer resynced to a different point while still paused.
    p.setTime(0);
    act(() =>
      result.current.accept({
        t: "media",
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

    act(() => result.current.load("dQw4w9WgXcQ", 0));
    const before = p.calls.length;
    act(() =>
      result.current.accept({
        t: "media",
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
    act(() => result.current.load("dQw4w9WgXcQ", 0));
    act(() => void vi.advanceTimersByTime(11_000));
    expect(JSON.stringify(sent)).not.toContain("volume");
    expect(p.calls.some((c) => c.startsWith("volume:"))).toBe(false);
  });

  it("does not touch a player that is not ready", () => {
    const p = fakePlayer(false);
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, () => {}),
    );
    act(() => result.current.load("dQw4w9WgXcQ", 0));
    act(() => void vi.advanceTimersByTime(5000));
    expect(p.calls).toEqual([]);
  });

  it("tells the peer whenever this side changes something", () => {
    const sent: PeerMessage[] = [];
    const p = fakePlayer();
    const { result } = renderHook(() =>
      useSyncedPlayback(p.handle, null, (m) => sent.push(m)),
    );

    act(() => result.current.load("dQw4w9WgXcQ", 0));
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

    act(() => result.current.load("dQw4w9WgXcQ", 0));
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

    act(() => result.current.load("dQw4w9WgXcQ", 0));
    act(() => result.current.clear());
    const afterClear = sent.length;
    act(() => void vi.advanceTimersByTime(11_000));
    expect(sent.length).toBe(afterClear);
  });
});
