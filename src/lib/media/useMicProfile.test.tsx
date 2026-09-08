import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMicProfile } from "./useMicProfile";
import type { AudioMode } from "./micProfile";
import { dbToGain, ECHO_SAFE_MAKEUP_GAIN_DB, MAKEUP_GAIN_DB } from "./micGain";
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

/**
 * Enough Web Audio for the real boost stage to build a graph, so the hook is
 * tested on the path that actually reaches a call rather than the jsdom path
 * where boostMic declines and hands the raw track straight back.
 */
function stubWebAudio(processed: MediaStreamTrack) {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const close = vi.fn(() => Promise.resolve());
  const gain = { ...node(), gain: { value: 0 } };
  vi.stubGlobal("MediaStream", class {});
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      createMediaStreamSource = () => node();
      createDynamicsCompressor = () => ({
        ...node(),
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
      });
      createGain = () => gain;
      createMediaStreamDestination = () => ({
        stream: { getAudioTracks: () => [processed] } as MediaStream,
      });
      close = close;
    },
  );
  return { close, gain };
}

// In afterEach rather than at the end of each test body: a failing assertion
// throws before any trailing cleanup runs, and a stubbed AudioContext left
// behind then changes the behaviour of every test after it -- which turns one
// real failure into a page of unrelated ones.
afterEach(() => vi.unstubAllGlobals());

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
      useMicProfile({ sender, mode: "headphones", noisy: false, source }),
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

  it("opens no microphone at all for ordinary talking", async () => {
    // The peer connection already opened one tuned for speech. Opening a second
    // almost identical to it ran two captures on one device all evening.
    const source = fakeSource([fakeTrack()]);
    const { sender, replaceTrack } = fakeSender();
    const original = fakeTrack();

    renderHook(() =>
      useMicProfile({ sender, mode: null, noisy: false, original, source }),
    );

    await Promise.resolve();
    expect(source.getUserMedia).not.toHaveBeenCalled();
    expect(replaceTrack).not.toHaveBeenCalled();
  });

  it("hands the call's own microphone back when the singing ends", async () => {
    const singing = fakeTrack();
    const source = fakeSource([singing]);
    const { sender, replaceTrack } = fakeSender();
    const original = fakeTrack();

    const { rerender } = renderHook(
      ({ mode }: { mode: AudioMode | null }) =>
        useMicProfile({ sender, mode, noisy: false, original, source }),
      { initialProps: { mode: "headphones" as AudioMode | null } },
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(singing));
    rerender({ mode: null });

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(original));
    // Only the one this hook opened, and only after the original is back.
    expect(singing.stop).toHaveBeenCalledOnce();
    expect(original.stop).not.toHaveBeenCalled();
  });

  it("keeps the singing microphone when there is nothing to restore", async () => {
    // A sender carrying this hook's only track must never be left with none:
    // the wrong profile is a worse-sounding call, no track is a silent one.
    const singing = fakeTrack();
    const source = fakeSource([singing]);
    const { sender, replaceTrack } = fakeSender();

    const { rerender } = renderHook(
      ({ mode }: { mode: AudioMode | null }) =>
        useMicProfile({ sender, mode, noisy: false, original: null, source }),
      { initialProps: { mode: "headphones" as AudioMode | null } },
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(singing));
    rerender({ mode: null });

    await act(async () => {});
    expect(replaceTrack).toHaveBeenCalledTimes(1);
    expect(singing.stop).not.toHaveBeenCalled();
  });

  it("sends the processed track and mutes the captured one", async () => {
    // The switch has to act on the microphone, not on the graph's output:
    // disabling the far end of the graph would leave the device recording
    // behind a control that says it is off.
    const captured = fakeTrack();
    const processed = fakeTrack();
    stubWebAudio(processed);
    const source = fakeSource([captured]);
    const { sender, replaceTrack } = fakeSender();

    const { result } = renderHook(() =>
      useMicProfile({
        sender,
        mode: "headphones",
        noisy: false,
        enabled: false,
        source,
      }),
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(processed));
    expect(result.current.track).toBe(processed);
    expect(captured.enabled).toBe(false);
  });

  it("closes the processing graph when the singing ends", async () => {
    const captured = fakeTrack();
    const { close } = stubWebAudio(fakeTrack());
    const source = fakeSource([captured]);
    const { sender, replaceTrack } = fakeSender();
    const original = fakeTrack();

    const { rerender } = renderHook(
      ({ mode }: { mode: AudioMode | null }) =>
        useMicProfile({ sender, mode, noisy: false, original, source }),
      { initialProps: { mode: "headphones" as AudioMode | null } },
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(1));
    rerender({ mode: null });

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(original));
    expect(close).toHaveBeenCalled();
    expect(captured.stop).toHaveBeenCalledOnce();
  });

  it("lifts a headphone microphone by the full makeup gain", async () => {
    const { gain } = stubWebAudio(fakeTrack());
    const source = fakeSource([fakeTrack()]);
    const { sender, replaceTrack } = fakeSender();

    renderHook(() =>
      useMicProfile({ sender, mode: "headphones", noisy: false, source }),
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(1));
    expect(gain.gain.value).toBeCloseTo(dbToGain(MAKEUP_GAIN_DB), 5);
  });

  it("holds a speaker microphone down to the echo-safe gain", async () => {
    // Speakers mean echo cancellation is on, which means the compressor is
    // sitting in front of a residual carrying the other person's voice back.
    const { gain } = stubWebAudio(fakeTrack());
    const source = fakeSource([fakeTrack()]);
    const { sender, replaceTrack } = fakeSender();

    renderHook(() =>
      useMicProfile({ sender, mode: "speakers", noisy: false, source }),
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(1));
    expect(gain.gain.value).toBeCloseTo(dbToGain(ECHO_SAFE_MAKEUP_GAIN_DB), 5);
  });

  it("holds a noisy speaker microphone down too, because cancellation is still on", async () => {
    const { gain } = stubWebAudio(fakeTrack());
    const source = fakeSource([fakeTrack()]);
    const { sender, replaceTrack } = fakeSender();

    renderHook(() =>
      useMicProfile({ sender, mode: "speakers", noisy: true, source }),
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(1));
    expect(gain.gain.value).toBeCloseTo(dbToGain(ECHO_SAFE_MAKEUP_GAIN_DB), 5);
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
      useMicProfile({ sender, mode: "headphones", noisy: false, source }),
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
