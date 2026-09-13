import { describe, it, expect, vi } from "vitest";
import {
  tuneMicrophone,
  SPEECH_AUDIO,
  HEADPHONE_AUDIO,
  SPEAKER_AUDIO,
  HEADPHONE_NOISY_AUDIO,
  SPEAKER_NOISY_AUDIO,
  singingProfile,
} from "./micProfile";

function fakeStream(trackCount = 1) {
  const applied: MediaTrackConstraints[] = [];
  const tracks = Array.from({ length: trackCount }, () => ({
    applyConstraints: (c: MediaTrackConstraints) => {
      applied.push(c);
      return Promise.resolve();
    },
  }));
  return {
    applied,
    stream: { getAudioTracks: () => tracks } as unknown as MediaStream,
  };
}

describe("audio profiles", () => {
  it("keeps echo cancellation on for speakers", () => {
    // The whole point of the speakers profile. Without it the microphone sends
    // the partner a second copy of the song they are already playing.
    expect(SPEAKER_AUDIO.echoCancellation).toBe(true);
  });

  it("drops echo cancellation only in headphones", () => {
    expect(HEADPHONE_AUDIO.echoCancellation).toBe(false);
    expect(SPEECH_AUDIO.echoCancellation).toBe(true);
  });

  it("frees the voice from speech processing in quiet singing modes", () => {
    // With no room noise to overcome, noise suppression and gain only treat
    // sustained music as noise or pump across a held note.
    for (const profile of [HEADPHONE_AUDIO, SPEAKER_AUDIO]) {
      expect(profile.noiseSuppression).toBe(false);
      expect(profile.autoGainControl).toBe(false);
    }
  });

  it("selects the headphones quiet profile", () => {
    expect(singingProfile("headphones", false)).toBe(HEADPHONE_AUDIO);
    expect(HEADPHONE_AUDIO).toEqual({
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
    });
  });

  it("selects the headphones noisy profile", () => {
    expect(singingProfile("headphones", true)).toBe(HEADPHONE_NOISY_AUDIO);
    expect(HEADPHONE_NOISY_AUDIO.autoGainControl).toBe(false);
    expect(HEADPHONE_NOISY_AUDIO.noiseSuppression).toBe(true);
    expect(HEADPHONE_NOISY_AUDIO).toEqual({
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
      voiceIsolation: false,
    });
  });

  it("selects the speakers quiet profile", () => {
    expect(singingProfile("speakers", false)).toBe(SPEAKER_AUDIO);
    expect(SPEAKER_AUDIO).toEqual({
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
    });
  });

  it("selects the speakers noisy profile", () => {
    expect(singingProfile("speakers", true)).toBe(SPEAKER_NOISY_AUDIO);
    expect(SPEAKER_NOISY_AUDIO.autoGainControl).toBe(false);
    expect(SPEAKER_NOISY_AUDIO.noiseSuppression).toBe(true);
    expect(SPEAKER_NOISY_AUDIO).toEqual({
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      voiceIsolation: false,
    });
  });

  it("asks every singing profile for one channel at the rate everything else runs at", () => {
    // Echo cancellation compares what the speakers played against what the
    // microphone heard. Left unasked, the device offers its own preference --
    // 44100 on the machine these reports come from -- and the canceller then
    // has to resample one clock into the other and chase the drift between
    // them. The person on speakers is the one who pays for that.
    for (const profile of [
      HEADPHONE_AUDIO,
      HEADPHONE_NOISY_AUDIO,
      SPEAKER_AUDIO,
      SPEAKER_NOISY_AUDIO,
    ]) {
      expect(profile.channelCount).toEqual({ ideal: 1 });
      expect(profile.sampleRate).toEqual({ ideal: 48000 });
    }
  });

  it("asks for the capture shape as a preference, never as a requirement", () => {
    // `exact` would let a device that cannot oblige refuse to open at all,
    // trading a slightly worse microphone for no microphone.
    for (const profile of [HEADPHONE_AUDIO, SPEAKER_AUDIO]) {
      expect(profile.channelCount).not.toHaveProperty("exact");
      expect(profile.sampleRate).not.toHaveProperty("exact");
    }
  });

  it("leaves every process on for ordinary talking", () => {
    expect(SPEECH_AUDIO).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });
});

describe("tuneMicrophone", () => {
  it("applies the headphone profile", async () => {
    const { stream, applied } = fakeStream();
    await tuneMicrophone(stream, "headphones");
    expect(applied).toEqual([HEADPHONE_AUDIO]);
  });

  it("applies the speaker profile", async () => {
    const { stream, applied } = fakeStream();
    await tuneMicrophone(stream, "speakers");
    expect(applied).toEqual([SPEAKER_AUDIO]);
  });

  it("returns to speech when no mode is set", async () => {
    const { stream, applied } = fakeStream();
    await tuneMicrophone(stream, null, true);
    expect(applied).toEqual([SPEECH_AUDIO]);
  });

  it("tunes every audio track", async () => {
    const { stream, applied } = fakeStream(2);
    await tuneMicrophone(stream, "speakers");
    expect(applied).toHaveLength(2);
  });

  it("does nothing without a stream", async () => {
    const result = await tuneMicrophone(null, "headphones");
    expect(result.settings).toBeNull();
    expect(result.error).toBeNull();
  });

  it("survives a device that refuses a constraint", async () => {
    // Not every device honours every constraint. A microphone left tuned for
    // speech is a worse-sounding karaoke, not a broken call.
    const stream = {
      getAudioTracks: () => [
        { applyConstraints: () => Promise.reject(new Error("unsupported")) },
      ],
    } as unknown as MediaStream;
    // The refusal no longer vanishes: the call carries on regardless, but the
    // reason is now recorded so somebody can see it happened.
    const result = await tuneMicrophone(stream, "headphones");
    expect(result.error).toBe("Error");
  });

  it("switches cleanly when someone puts headphones on mid-song", async () => {
    const { stream, applied } = fakeStream();
    await tuneMicrophone(stream, "speakers");
    await tuneMicrophone(stream, "headphones");
    expect(applied).toEqual([SPEAKER_AUDIO, HEADPHONE_AUDIO]);
  });
});

describe("no dependency on renegotiation", () => {
  it("only ever touches the existing tracks", async () => {
    // applyConstraints retunes the live track, so the peer connection is never
    // renegotiated and the call does not drop when the mode changes.
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const { stream } = fakeStream();
    await tuneMicrophone(stream, "headphones");
    expect(getUserMedia).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
