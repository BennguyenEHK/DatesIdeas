import { describe, expect, it, vi } from "vitest";
import {
  NATURAL_VOICE_AUDIO,
  reopenMic,
  swapStreamMic,
  type MicOpener,
} from "./naturalVoice";

const CALL_AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
};

function fakeTrack(settings: Record<string, unknown> = {}) {
  return {
    kind: "audio",
    enabled: true,
    getSettings: () => settings as MediaTrackSettings,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
}

/** Hands out the given tracks in order, one per getUserMedia call; null refuses. */
function opener(...tracks: Array<MediaStreamTrack | null>): MicOpener & {
  getUserMedia: ReturnType<typeof vi.fn>;
} {
  return {
    getUserMedia: vi.fn(async () => {
      const track = tracks.shift();
      if (!track) throw new DOMException("no device", "NotReadableError");
      return { getAudioTracks: () => [track] } as unknown as MediaStream;
    }),
  };
}

describe("the natural voice request", () => {
  it("keeps echo cancellation and auto-volume on, and takes the noise filter off", () => {
    // Echo cancellation is never negotiable here: without it the microphone
    // sends the speakers straight back, which is the loop this app had.
    // Auto-volume stays too: with no boost stage, it is the only thing that
    // keeps a singer who steps back from the laptop audible.
    expect(NATURAL_VOICE_AUDIO).toEqual({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    });
  });
});

describe("reopenMic", () => {
  it("opens the natural microphone when the device keeps its echo canceller", async () => {
    const natural = fakeTrack({ echoCancellation: true, noiseSuppression: false });
    const source = opener(natural);

    const result = await reopenMic(source, "natural", CALL_AUDIO);

    expect(source.getUserMedia).toHaveBeenCalledWith({ audio: NATURAL_VOICE_AUDIO });
    expect(result).toEqual({ track: natural, mode: "natural", outcome: "ok" });
  });

  it("goes back to the call's microphone when the echo canceller is refused", async () => {
    const refused = fakeTrack({ echoCancellation: false });
    const call = fakeTrack({ echoCancellation: true });
    const source = opener(refused, call);

    const result = await reopenMic(source, "natural", CALL_AUDIO);

    expect(refused.stop).toHaveBeenCalledOnce();
    expect(source.getUserMedia).toHaveBeenLastCalledWith({ audio: CALL_AUDIO });
    expect(result).toEqual({ track: call, mode: "call", outcome: "refused" });
  });

  it("goes back to the call's microphone when the natural one will not open", async () => {
    const call = fakeTrack({ echoCancellation: true });
    const source = opener(null, call);

    const result = await reopenMic(source, "natural", CALL_AUDIO);

    expect(result).toEqual({ track: call, mode: "call", outcome: "failed" });
  });

  it("reports no microphone at all only when both requests fail", async () => {
    const result = await reopenMic(opener(null, null), "natural", CALL_AUDIO);
    expect(result).toEqual({ track: null, mode: "call", outcome: "failed" });
  });

  it("opens the call's microphone when asked to go back", async () => {
    const call = fakeTrack({ echoCancellation: true });
    const source = opener(call);

    const result = await reopenMic(source, "call", CALL_AUDIO);

    expect(source.getUserMedia).toHaveBeenCalledWith({ audio: CALL_AUDIO });
    expect(result).toEqual({ track: call, mode: "call", outcome: "ok" });
  });
});

describe("swapStreamMic", () => {
  function fakeStream(tracks: MediaStreamTrack[]) {
    const list = [...tracks];
    return {
      getAudioTracks: () => list.filter((t) => t.kind === "audio"),
      removeTrack: vi.fn((t: MediaStreamTrack) => list.splice(list.indexOf(t), 1)),
      addTrack: vi.fn((t: MediaStreamTrack) => void list.push(t)),
      list,
    };
  }

  it("puts the new microphone in the stream and on the call, in the mute state", async () => {
    const old = fakeTrack();
    const video = { kind: "video" } as MediaStreamTrack;
    const stream = fakeStream([old, video]);
    const replaceTrack = vi.fn(async () => {});
    const next = fakeTrack();

    await swapStreamMic(stream as unknown as MediaStream, { replaceTrack }, next, false);

    expect(stream.list).toEqual([video, next]);
    expect(replaceTrack).toHaveBeenCalledWith(next);
    // A freshly opened track arrives enabled; a muted person must stay muted.
    expect(next.enabled).toBe(false);
  });

  it("still updates the stream when there is no call to tell yet", async () => {
    const stream = fakeStream([fakeTrack()]);
    const next = fakeTrack();

    await swapStreamMic(stream as unknown as MediaStream, null, next, true);

    expect(stream.list).toEqual([next]);
  });
});
