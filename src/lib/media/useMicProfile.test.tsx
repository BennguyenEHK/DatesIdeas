import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useMicProfile } from "./useMicProfile";
import type { AudioMode } from "./micProfile";
import type { AudioSenderLike, MicSource } from "./micSwap";

function fakeTrack(settings: Record<string, unknown> = {}) {
  const stop = vi.fn();
  return {
    kind: "audio",
    getSettings: () => settings as MediaTrackSettings,
    stop,
  } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
}

function fakeStream(track: MediaStreamTrack): MediaStream {
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function fakeSource(tracks: MediaStreamTrack[]): MicSource & {
  getUserMedia: ReturnType<typeof vi.fn>;
} {
  return {
    getUserMedia: vi.fn(() => {
      const track = tracks.shift();
      return Promise.resolve(track === undefined ? null : fakeStream(track));
    }),
  } as MicSource & { getUserMedia: ReturnType<typeof vi.fn> };
}

function fakeSender() {
  const replaceTrack = vi.fn(() => Promise.resolve());
  const sender: AudioSenderLike = { track: { kind: "audio" }, replaceTrack };
  return { sender, replaceTrack };
}

describe("useMicProfile", () => {
  it("does not open a microphone before there is an audio sender", () => {
    const source = fakeSource([fakeTrack()]);

    const { result } = renderHook(() =>
      useMicProfile({ sender: null, mode: null, noisy: false, source }),
    );

    expect(source.getUserMedia).not.toHaveBeenCalled();
    expect(result.current).toEqual({
      settings: null,
      unmet: [],
      error: null,
      track: null,
    });
  });

  it("opens a first microphone and puts it on the call", async () => {
    const track = fakeTrack({ echoCancellation: true });
    const source = fakeSource([track]);
    const { sender, replaceTrack } = fakeSender();
    const { result } = renderHook(() =>
      useMicProfile({ sender, mode: null, noisy: false, source }),
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(track));
    expect(result.current.track).toBe(track);
    expect(result.current.settings?.echoCancellation).toBe(true);
  });

  it("does not reopen when the resolved profile is unchanged", async () => {
    const source = fakeSource([fakeTrack(), fakeTrack()]);
    const { sender, replaceTrack } = fakeSender();
    const { rerender } = renderHook(
      ({ noisy }) => useMicProfile({ sender, mode: "headphones", noisy, source }),
      { initialProps: { noisy: false } },
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(1));
    rerender({ noisy: false });
    expect(source.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("reopens for a different singing mode and stops the replaced microphone", async () => {
    const first = fakeTrack();
    const second = fakeTrack();
    const source = fakeSource([first, second]);
    const { sender, replaceTrack } = fakeSender();
    const { rerender } = renderHook(
      ({ mode }) => useMicProfile({ sender, mode, noisy: false, source }),
      { initialProps: { mode: "headphones" as AudioMode } },
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(first));
    rerender({ mode: "speakers" });
    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(second));
    expect(first.stop).toHaveBeenCalledOnce();
  });

  it("reopens when room noise resolves to a different profile", async () => {
    const source = fakeSource([fakeTrack(), fakeTrack()]);
    const { sender, replaceTrack } = fakeSender();
    const { rerender } = renderHook(
      ({ noisy }) => useMicProfile({ sender, mode: "headphones", noisy, source }),
      { initialProps: { noisy: false } },
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(1));
    rerender({ noisy: true });
    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(2));
  });

  it("keeps the working microphone when opening the replacement fails", async () => {
    const first = fakeTrack();
    const source: MicSource = {
      getUserMedia: vi
        .fn()
        .mockResolvedValueOnce(fakeStream(first))
        .mockRejectedValueOnce(new Error("denied")),
    };
    const { sender, replaceTrack } = fakeSender();
    const { result, rerender } = renderHook(
      ({ mode }) => useMicProfile({ sender, mode, noisy: false, source }),
      { initialProps: { mode: "headphones" as AudioMode } },
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(first));
    rerender({ mode: "speakers" });
    await waitFor(() => expect(result.current.error).toBe("unavailable"));
    expect(result.current.track).toBe(first);
    expect(first.stop).not.toHaveBeenCalled();
  });

  it("releases the microphone it opened on unmount", async () => {
    const track = fakeTrack();
    const source = fakeSource([track]);
    const { sender, replaceTrack } = fakeSender();
    const { unmount } = renderHook(() =>
      useMicProfile({ sender, mode: null, noisy: false, source }),
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(track));
    unmount();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("stops an outdated microphone that finishes opening after a newer request", async () => {
    const stale = fakeTrack();
    const resolvers: Array<(stream: MediaStream) => void> = [];
    const source: MicSource = {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    };
    const { sender, replaceTrack } = fakeSender();
    const { rerender } = renderHook(
      ({ mode }) => useMicProfile({ sender, mode, noisy: false, source }),
      { initialProps: { mode: "headphones" as AudioMode } },
    );

    await waitFor(() => expect(source.getUserMedia).toHaveBeenCalledTimes(1));
    rerender({ mode: "speakers" });
    await waitFor(() => expect(source.getUserMedia).toHaveBeenCalledTimes(2));
    act(() => resolvers[0]?.(fakeStream(stale)));
    await waitFor(() => expect(stale.stop).toHaveBeenCalledOnce());
    expect(replaceTrack).not.toHaveBeenCalledWith(stale);
  });
});

/**
 * StrictMode mounts every component, tears it down, and mounts it again --
 * on the SAME instance, so refs survive. A "still mounted" flag that is only
 * ever turned off is therefore false for the whole second life of the hook,
 * and every microphone it opens is discarded and stopped on arrival. In
 * development that is every karaoke session.
 *
 * This has to be driven through StrictMode rather than by rendering the hook
 * twice: two renderHook calls build two instances with two fresh refs, which
 * is precisely the case that already worked.
 */
describe("under StrictMode's double mount", () => {
  it("still gets its microphone onto the sender", async () => {
    // Two tracks, because the double mount legitimately opens twice.
    const source = fakeSource([fakeTrack(), fakeTrack()]);
    const { sender, replaceTrack } = fakeSender();

    const { result } = renderHook(
      () => useMicProfile({ sender, mode: "headphones", noisy: false, source }),
      { wrapper: StrictMode },
    );

    await waitFor(() => expect(result.current.track).not.toBeNull());
    expect(replaceTrack).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
