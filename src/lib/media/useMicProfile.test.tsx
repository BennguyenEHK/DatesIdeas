import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioMode } from "./micProfile";
import type { AudioSenderLike, MicSource } from "./micSwap";
import type { VoiceChain } from "./voiceChain";
import type { VoiceStyle } from "./voiceStyles";

// The graph itself is tested in voiceChain.test.ts. Here only its contract
// matters: what the hook asks for, what it sends, and what it releases.
const chainMock = vi.hoisted(() => ({ buildVoiceChain: vi.fn() }));
vi.mock("./voiceChain", () => chainMock);

import { useMicProfile } from "./useMicProfile";

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

function fakeChain(
  track: MediaStreamTrack,
  style: VoiceStyle = "open",
  dynamics = true,
): VoiceChain & { close: ReturnType<typeof vi.fn<() => void>> } {
  return { track, style, dynamics, close: vi.fn<() => void>() };
}

beforeEach(() => {
  // By default no graph can be built, which is the raw-microphone path.
  chainMock.buildVoiceChain.mockResolvedValue(null);
});

// In afterEach rather than at the end of each test body: a failing assertion
// throws before any trailing cleanup runs, and a mock left configured then
// changes the behaviour of every test after it.
afterEach(() => {
  vi.unstubAllGlobals();
  chainMock.buildVoiceChain.mockReset();
});

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
      style: null,
      dynamics: false,
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
    expect(chainMock.buildVoiceChain).not.toHaveBeenCalled();
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
    chainMock.buildVoiceChain.mockResolvedValue(fakeChain(processed));
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
    expect(chainMock.buildVoiceChain).toHaveBeenCalledWith(captured, "open");
    expect(result.current.track).toBe(processed);
    expect(result.current.style).toBe("open");
    expect(result.current.dynamics).toBe(true);
    expect(captured.enabled).toBe(false);
  });

  it("closes the processing graph when the singing ends", async () => {
    const captured = fakeTrack();
    const chain = fakeChain(fakeTrack());
    chainMock.buildVoiceChain.mockResolvedValue(chain);
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
    expect(chain.close).toHaveBeenCalledOnce();
    expect(captured.stop).toHaveBeenCalledOnce();
  });

  it("shapes speakers in a quiet room with the echo gate", async () => {
    const captured = fakeTrack();
    const source = fakeSource([captured]);
    const { sender, replaceTrack } = fakeSender();

    renderHook(() =>
      useMicProfile({ sender, mode: "speakers", noisy: false, source }),
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(1));
    expect(chainMock.buildVoiceChain).toHaveBeenCalledWith(captured, "open-speakers");
  });

  it("shapes a noisy room without any lift when the song is on speakers", async () => {
    const headphones = fakeTrack();
    const speakers = fakeTrack();
    const source = fakeSource([headphones, speakers]);
    const { sender, replaceTrack } = fakeSender();
    const { rerender } = renderHook(
      ({ mode }) => useMicProfile({ sender, mode, noisy: true, source }),
      { initialProps: { mode: "headphones" as AudioMode } },
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(1));
    rerender({ mode: "speakers" });
    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(2));
    expect(chainMock.buildVoiceChain).toHaveBeenNthCalledWith(1, headphones, "clean");
    expect(chainMock.buildVoiceChain).toHaveBeenNthCalledWith(
      2,
      speakers,
      "clean-speakers",
    );
  });

  it("rebuilds when only the room changes, though the device profile is the same", async () => {
    // Quiet and noisy now ask the device for identical constraints. The style
    // is what differs, so the key has to include it or the switch does nothing.
    const first = fakeTrack();
    const second = fakeTrack();
    const firstChain = fakeChain(fakeTrack());
    chainMock.buildVoiceChain
      .mockResolvedValueOnce(firstChain)
      .mockResolvedValueOnce(fakeChain(fakeTrack(), "clean"));
    const source = fakeSource([first, second]);
    const { sender, replaceTrack } = fakeSender();
    const { result, rerender } = renderHook(
      ({ noisy }) => useMicProfile({ sender, mode: "headphones", noisy, source }),
      { initialProps: { noisy: false } },
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(1));
    rerender({ noisy: true });
    await waitFor(() => expect(replaceTrack).toHaveBeenCalledTimes(2));
    expect(chainMock.buildVoiceChain).toHaveBeenLastCalledWith(second, "clean");
    expect(result.current.style).toBe("clean");
    expect(firstChain.close).toHaveBeenCalledOnce();
    expect(first.stop).toHaveBeenCalledOnce();
  });

  it("sends the raw microphone when no chain can be built", async () => {
    const captured = fakeTrack();
    const source = fakeSource([captured]);
    const { sender, replaceTrack } = fakeSender();

    const { result } = renderHook(() =>
      useMicProfile({ sender, mode: "speakers", noisy: false, source }),
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(captured));
    expect(result.current.track).toBe(captured);
    expect(result.current.style).toBe("open-speakers");
    expect(result.current.dynamics).toBe(false);
  });

  it("releases a chain that finishes building after a newer request", async () => {
    const stale = fakeTrack();
    const staleChain = fakeChain(fakeTrack());
    let finish: (chain: VoiceChain) => void = () => undefined;
    chainMock.buildVoiceChain
      .mockImplementationOnce(() => new Promise<VoiceChain>((resolve) => (finish = resolve)))
      .mockResolvedValue(null);
    const source = fakeSource([stale, fakeTrack()]);
    const { sender, replaceTrack } = fakeSender();
    const { rerender } = renderHook(
      ({ noisy }) => useMicProfile({ sender, mode: "headphones", noisy, source }),
      { initialProps: { noisy: false } },
    );

    await waitFor(() => expect(chainMock.buildVoiceChain).toHaveBeenCalledTimes(1));
    rerender({ noisy: true });
    await act(async () => finish(staleChain));

    await waitFor(() => expect(staleChain.close).toHaveBeenCalledOnce());
    expect(stale.stop).toHaveBeenCalledOnce();
    expect(replaceTrack).not.toHaveBeenCalledWith(staleChain.track);
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
    const chain = fakeChain(fakeTrack());
    chainMock.buildVoiceChain.mockResolvedValue(chain);
    const source = fakeSource([track]);
    const { sender, replaceTrack } = fakeSender();
    const { unmount } = renderHook(() =>
      useMicProfile({ sender, mode: "headphones", noisy: false, source }),
    );

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith(chain.track));
    unmount();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(chain.close).toHaveBeenCalledOnce();
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
