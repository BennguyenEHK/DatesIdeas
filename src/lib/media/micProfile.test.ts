import { describe, it, expect, vi } from "vitest";
import {
  tuneMicrophone,
  SPEECH_AUDIO,
  HEADPHONE_AUDIO,
  SPEAKER_AUDIO,
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

  it("frees the voice from speech processing in both singing modes", () => {
    // Noise suppression treats sustained music as noise and gain pumps across
    // a held note. Neither belongs in a song, whatever you are listening on.
    for (const profile of [HEADPHONE_AUDIO, SPEAKER_AUDIO]) {
      expect(profile.noiseSuppression).toBe(false);
      expect(profile.autoGainControl).toBe(false);
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
    await tuneMicrophone(stream, null);
    expect(applied).toEqual([SPEECH_AUDIO]);
  });

  it("tunes every audio track", async () => {
    const { stream, applied } = fakeStream(2);
    await tuneMicrophone(stream, "speakers");
    expect(applied).toHaveLength(2);
  });

  it("does nothing without a stream", async () => {
    await expect(tuneMicrophone(null, "headphones")).resolves.toBeUndefined();
  });

  it("survives a device that refuses a constraint", async () => {
    // Not every device honours every constraint. A microphone left tuned for
    // speech is a worse-sounding karaoke, not a broken call.
    const stream = {
      getAudioTracks: () => [
        { applyConstraints: () => Promise.reject(new Error("unsupported")) },
      ],
    } as unknown as MediaStream;
    await expect(tuneMicrophone(stream, "headphones")).resolves.toBeUndefined();
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
