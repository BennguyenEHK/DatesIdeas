import { describe, it, expect } from "vitest";
import {
  describeMic,
  readMicSettings,
  unmetRequests,
  type MicSettings,
  type SettingsTrackLike,
} from "./micState";
import { HEADPHONE_AUDIO, SPEAKER_AUDIO, SPEECH_AUDIO } from "./micProfile";

const track = (
  settings: Record<string, unknown>,
  label?: string,
): SettingsTrackLike => ({
  getSettings: () => settings as MediaTrackSettings,
  ...(label === undefined ? {} : { label }),
});

const settings = (over: Partial<MicSettings> = {}): MicSettings => ({
  echoCancellation: null,
  noiseSuppression: null,
  autoGainControl: null,
  voiceIsolation: null,
  label: null,
  channelCount: null,
  sampleRate: null,
  ...over,
});

describe("readMicSettings", () => {
  it("reads what the device actually settled on", () => {
    expect(
      readMicSettings(
        track({
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
        }),
      ),
    ).toEqual(
      settings({
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000,
      }),
    );
  });

  it("reads voice isolation where the browser reports it", () => {
    // Newer Chrome exposes the operating system's own voice isolation here.
    // It sits below every constraint this app sets and is a prime suspect for
    // a microphone that gates on a sustained note, so it must be visible.
    const read = readMicSettings(track({ voiceIsolation: true }));
    expect(read?.voiceIsolation).toBe(true);
  });

  it("reports null for anything the browser does not say", () => {
    expect(readMicSettings(track({}))).toEqual(settings());
  });

  it("returns null when the track cannot report settings at all", () => {
    expect(readMicSettings({})).toBeNull();
  });

  it("survives a track whose getSettings throws", () => {
    expect(
      readMicSettings({
        getSettings: () => {
          throw new Error("not supported");
        },
      }),
    ).toBeNull();
  });
});

/**
 * The reason this module exists. The app has always asked for a singing
 * profile and never once checked whether it arrived, so a browser that quietly
 * ignores the request is indistinguishable from one that honours it -- and the
 * two produce completely different microphones.
 */
describe("unmetRequests", () => {
  it("names a processing flag the device refused to change", () => {
    expect(
      unmetRequests(HEADPHONE_AUDIO, settings({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      })),
    ).toEqual(["echoCancellation", "noiseSuppression", "autoGainControl"]);
  });

  it("is empty when the device did what it was asked", () => {
    expect(
      unmetRequests(HEADPHONE_AUDIO, settings({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      })),
    ).toEqual([]);
  });

  it("names only the flags that actually disagree", () => {
    expect(
      unmetRequests(SPEAKER_AUDIO, settings({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      })),
    ).toEqual(["noiseSuppression"]);
  });

  it("does not accuse a device of refusing something it never reported", () => {
    // A browser that omits the field is silent, not disobedient. Reporting it
    // as refused would send someone chasing a fault that may not exist.
    expect(unmetRequests(SPEECH_AUDIO, settings())).toEqual([]);
  });

  it("has nothing to say when settings could not be read", () => {
    expect(unmetRequests(HEADPHONE_AUDIO, null)).toEqual([]);
  });
});

describe("describeMic", () => {
  it("writes the processing chain as on and off", () => {
    expect(
      describeMic(settings({
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000,
      })),
    ).toBe("aec on, ns off, agc off, mono, 48000Hz");
  });

  it("names stereo when two channels survived", () => {
    expect(describeMic(settings({ channelCount: 2 }))).toBe("stereo");
  });

  it("mentions voice isolation only when it is on", () => {
    expect(describeMic(settings({ voiceIsolation: true }))).toBe(
      "voice isolation ON",
    );
    expect(describeMic(settings({ voiceIsolation: false }))).toBe("");
  });

  it("says so plainly when nothing could be read", () => {
    expect(describeMic(null)).toBe("unknown");
  });
});

describe("the device behind the settings", () => {
  it("names the microphone the browser actually opened", () => {
    // Two microphones attached and the wrong one chosen looks identical to a
    // correctly tuned right one, in every other field of the report.
    expect(readMicSettings(track({}, "Headset (Yeti Nano)"))?.label).toBe(
      "Headset (Yeti Nano)",
    );
  });

  it("treats a nameless device as unknown rather than as a device called nothing", () => {
    // The browser leaves the label empty until permission has been granted.
    expect(readMicSettings(track({}, ""))?.label).toBeNull();
    expect(readMicSettings(track({}))?.label).toBeNull();
  });
});

