import { describe, expect, it, vi } from "vitest";
import {
  openMic,
  stopMic,
  swapMicTrack,
  type AudioSenderLike,
  type MicSource,
} from "./micSwap";
import { HEADPHONE_AUDIO } from "./micProfile";

function fakeTrack(settings: Record<string, unknown> = {}) {
  const stop = vi.fn();
  return {
    kind: "audio",
    getSettings: () => settings as MediaTrackSettings,
    stop,
  } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
}

function fakeStream(
  audioTracks: MediaStreamTrack[] = [],
  tracks: MediaStreamTrack[] = audioTracks,
): MediaStream {
  return {
    getAudioTracks: () => audioTracks,
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function fakeSource(stream: MediaStream): MicSource & {
  getUserMedia: ReturnType<typeof vi.fn>;
} {
  return {
    getUserMedia: vi.fn(() => Promise.resolve(stream)),
  };
}

describe("openMic", () => {
  it("keeps a refused microphone from breaking the call", async () => {
    const source: MicSource = {
      getUserMedia: () => Promise.reject(new Error("permission denied")),
    };

    await expect(openMic(source, HEADPHONE_AUDIO)).resolves.toBeNull();
  });

  it("returns null when the source cannot open microphones", async () => {
    const source = {} as MicSource;

    await expect(openMic(source, HEADPHONE_AUDIO)).resolves.toBeNull();
  });

  it("does not keep a stream that contains no audio", async () => {
    const source = fakeSource(fakeStream());

    await expect(openMic(source, HEADPHONE_AUDIO)).resolves.toBeNull();
  });

  it("opens the requested profile and reports the settled microphone", async () => {
    const track = fakeTrack({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
      sampleRate: 48000,
    });
    const stream = fakeStream([track]);
    const source = fakeSource(stream);

    await expect(openMic(source, HEADPHONE_AUDIO)).resolves.toEqual({
      track,
      stream,
      settings: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        voiceIsolation: null,
        channelCount: 2,
        sampleRate: 48000,
        label: null,
      },
      unmet: [],
    });
    expect(source.getUserMedia).toHaveBeenCalledWith({ audio: HEADPHONE_AUDIO });
  });

  it("reports a new microphone that still settled on speech processing", async () => {
    const track = fakeTrack({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    const source = fakeSource(fakeStream([track]));

    const opened = await openMic(source, HEADPHONE_AUDIO);

    expect(opened?.unmet).toEqual([
      "echoCancellation",
      "noiseSuppression",
      "autoGainControl",
    ]);
  });
});

describe("swapMicTrack", () => {
  it("leaves a non-audio sender untouched", async () => {
    const replaceTrack = vi.fn(() => Promise.resolve());
    const sender: AudioSenderLike = { track: { kind: "video" }, replaceTrack };

    await expect(swapMicTrack(sender, fakeTrack())).resolves.toBe(false);
    expect(replaceTrack).not.toHaveBeenCalled();
  });

  it("keeps the call alive when replacing the microphone is rejected", async () => {
    const sender: AudioSenderLike = {
      track: { kind: "audio" },
      replaceTrack: () => Promise.reject(new Error("unsupported")),
    };

    await expect(swapMicTrack(sender, fakeTrack())).resolves.toBe(false);
  });

  it("replaces an audio sender without renegotiating", async () => {
    const replaceTrack = vi.fn(() => Promise.resolve());
    const sender: AudioSenderLike = { track: { kind: "audio" }, replaceTrack };
    const next = fakeTrack();

    await expect(swapMicTrack(sender, next)).resolves.toBe(true);
    expect(replaceTrack).toHaveBeenCalledWith(next);
  });
});

describe("stopMic", () => {
  it("does nothing without an opened microphone", () => {
    expect(() => stopMic(null)).not.toThrow();
  });

  it("stops every track the opened stream returned", () => {
    const audio = fakeTrack();
    const video = fakeTrack();
    const stream = fakeStream([audio], [audio, video]);

    stopMic({ track: audio, stream, settings: null, unmet: [] });

    expect(audio.stop).toHaveBeenCalledOnce();
    expect(video.stop).toHaveBeenCalledOnce();
  });
});
