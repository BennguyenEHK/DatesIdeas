import { describe, it, expect, vi } from "vitest";
import {
  tuneMicrophone,
  classifyMic,
  singingSetup,
  SPEECH_AUDIO,
  HEADSET_AUDIO,
  OPEN_MIC_AUDIO,
} from "./micProfile";
import {
  ECHO_SAFE_MAKEUP_GAIN_DB,
  MAKEUP_GAIN_DB,
  SPEAKER_MAKEUP_GAIN_DB,
} from "./micGain";

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

describe("classifyMic", () => {
  it("knows a microphone worn at the mouth by its name", () => {
    for (const label of [
      "Headset Microphone (Realtek(R) Audio)",
      "Headset (WH-1000XM4 Hands-Free AG Audio)",
      "AirPods Pro",
      "Galaxy Buds2 Hands-Free",
      "USB Headphones Mic",
    ]) {
      expect(classifyMic(label)).toBe("headset");
    }
  });

  it("treats every other microphone as one that can hear the room", () => {
    // Laptop arrays sit a few centimetres from the speakers and hear whatever
    // leaks out of headphones. A generic name could be either, and guessing
    // "open" only costs a canceller that has little to cancel.
    for (const label of [
      "Microphone Array (Realtek(R) Audio)",
      "Microphone Array (Intel® Smart Sound Technology for Digital Microphones)",
      "MacBook Pro Microphone",
      "Microphone (Realtek(R) Audio)",
      "Default",
      "",
    ]) {
      expect(classifyMic(label)).toBe("open");
    }
    expect(classifyMic(null)).toBe("open");
    expect(classifyMic(undefined)).toBe("open");
  });
});

describe("singing profiles", () => {
  it("never uses the browser's noise suppressor or automatic gain for singing", () => {
    // Both are built for speech: the suppressor fades a held note as if it
    // were a fan, and automatic gain pumps across it. Ordinary talking keeps
    // them; karaoke never does, whatever the room.
    for (const profile of [HEADSET_AUDIO, OPEN_MIC_AUDIO]) {
      expect(profile.noiseSuppression).toBe(false);
      expect(profile.autoGainControl).toBe(false);
      expect((profile as { voiceIsolation?: boolean }).voiceIsolation).toBe(false);
    }
  });

  it("drops echo cancellation only for a microphone worn at the mouth", () => {
    expect(HEADSET_AUDIO.echoCancellation).toBe(false);
    expect(OPEN_MIC_AUDIO.echoCancellation).toBe(true);
  });

  it("keeps cancellation on for a laptop microphone under headphones", () => {
    // The laptop's own microphone still hears the other person leaking out of
    // the headphones, and with cancellation off that leak went back to them.
    expect(singingSetup("headphones", "open")).toEqual({
      constraints: OPEN_MIC_AUDIO,
      makeupDb: ECHO_SAFE_MAKEUP_GAIN_DB,
    });
  });

  it("gives the full lift only to a headset microphone under headphones", () => {
    expect(singingSetup("headphones", "headset")).toEqual({
      constraints: HEADSET_AUDIO,
      makeupDb: MAKEUP_GAIN_DB,
    });
  });

  it("adds no lift of its own on speakers, whatever the microphone", () => {
    // Anything lifted on speakers lifts the canceller's leftover too, which is
    // the other person's voice coming back to them.
    for (const mic of ["open", "headset"] as const) {
      expect(singingSetup("speakers", mic)).toEqual({
        constraints: OPEN_MIC_AUDIO,
        makeupDb: SPEAKER_MAKEUP_GAIN_DB,
      });
    }
    expect(SPEAKER_MAKEUP_GAIN_DB).toBe(0);
  });

  it("asks every singing profile for one channel at the rate everything else runs at", () => {
    for (const profile of [HEADSET_AUDIO, OPEN_MIC_AUDIO]) {
      expect(profile.channelCount).toEqual({ ideal: 1 });
      expect(profile.sampleRate).toEqual({ ideal: 48000 });
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
  it("applies the headset profile", async () => {
    const { stream, applied } = fakeStream();
    await tuneMicrophone(stream, "headphones", "headset");
    expect(applied).toEqual([HEADSET_AUDIO]);
  });

  it("applies the open-microphone profile", async () => {
    const { stream, applied } = fakeStream();
    await tuneMicrophone(stream, "speakers");
    expect(applied).toEqual([OPEN_MIC_AUDIO]);
  });

  it("returns to speech when no mode is set", async () => {
    const { stream, applied } = fakeStream();
    await tuneMicrophone(stream, null, "headset");
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
    await tuneMicrophone(stream, "speakers", "headset");
    await tuneMicrophone(stream, "headphones", "headset");
    expect(applied).toEqual([OPEN_MIC_AUDIO, HEADSET_AUDIO]);
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
