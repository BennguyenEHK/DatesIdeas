/**
 * How a singing microphone is shaped after the browser hands it over.
 *
 * The browser's own processing is built for talking. Its noise suppressor
 * treats a held note as steady noise and turns it down, and it takes the top
 * of the voice with it -- the "muffled high notes". So every singing profile
 * switches that suppressor off (see micProfile.ts) and the room is handled
 * here instead, with tools that change a voice's LEVEL but never its tone:
 *
 * - a gate, which only closes when nobody is singing. Between phrases it turns
 *   down the room and, on speakers, the faint copy of the other person that
 *   echo cancellation always leaves behind.
 * - a compressor, to keep the voice level steady.
 * - makeup gain, in headphones only.
 * - a limiter, so nothing can push a loud note into clipping.
 *
 * THE RULE ON SPEAKERS: this stage never makes anything louder. Two people on
 * speakers are a loop -- her voice out of your speakers, into your
 * microphone, out of hers, into hers -- and echo cancellation is the only
 * thing keeping that loop below unity. Any gain added here is added to the
 * loop, twice, once per side. The first version of this file gave speakers
 * +6dB at every level; a loop that had been a faint echo climbed until the
 * limiter held it at full scale, and both people heard a constant loud tone.
 * voiceDynamics.test.ts now simulates that loop.
 *
 * THE RULE EVERYWHERE: at a loud input the total gain is at or below 0dB. Even
 * where makeup gain is safe, a loud signal is never lifted further, so a loop
 * nobody expected (headphones chosen while the song plays on speakers) settles
 * rather than running to the ceiling.
 */
import type { AudioMode } from "./micProfile";

/** Which shaping a singing microphone gets. */
export type VoiceStyle =
  /** Headphones, quiet room: the voice as captured, lifted when quiet, never above 0dB when loud. */
  | "open"
  /** Speakers, quiet room: as captured, no gain, a gate shutting out the echo residual between phrases. */
  | "open-speakers"
  /** Headphones, noisy room: rumble cut, presence lifted, room gated, level held steady. */
  | "clean"
  /** Speakers, noisy room: rumble cut, room gated, level held steady -- and nothing lifted. */
  | "clean-speakers";

/** A downward gate driven by the INPUT level (before any makeup gain). */
export interface GateSettings {
  /** Below this input level the gate starts closing. */
  thresholdDb: number;
  /** How far a fully closed gate turns the signal down, as a positive number. */
  rangeDb: number;
  /** How long the level must stay below threshold before the gate starts to close. */
  holdMs: number;
  /** How fast the gate opens once the level is back above threshold. */
  attackMs: number;
  /** How long a closing gate takes to reach its full range. */
  releaseMs: number;
}

/** A feed-forward compressor driven by the input level. No hidden makeup gain. */
export interface CompressorSettings {
  thresholdDb: number;
  /** e.g. 2.5 means 2.5dB in above threshold becomes 1dB out. */
  ratio: number;
  attackMs: number;
  releaseMs: number;
}

/** Everything the "voice-dynamics" worklet processor needs, passed as processorOptions. */
export interface VoiceDynamicsSettings {
  gate: GateSettings | null;
  compressor: CompressorSettings | null;
  /** Fixed gain applied after gate and compressor. Zero on speakers, always. */
  makeupDb: number;
  /** The limiter's ceiling. No output sample may exceed this, ever. */
  ceilingDb: number;
}

export interface VoiceStyleDef {
  /** A 12dB/octave high-pass below the voice, or null for none. */
  highpassHz: number | null;
  /**
   * A peaking lift where a voice cuts through a room, or null for none.
   * Headphones only: a peak is exactly the frequency a feedback loop rings at.
   */
  presence: { frequencyHz: number; gainDb: number; q: number } | null;
  dynamics: VoiceDynamicsSettings;
}

/** The name the worklet module registers its processor under. */
export const VOICE_PROCESSOR_NAME = "voice-dynamics";

/** Where the worklet module is served from (public/worklets/voice-dynamics.js). */
export const VOICE_WORKLET_URL = "/worklets/voice-dynamics.js";

/** Just under full scale, so encoders and resamplers downstream have a little room. */
const CEILING_DB = -1;

/** The echo residual and room between phrases on speakers sit below this; soft singing above. */
const SPEAKER_GATE: GateSettings = {
  thresholdDb: -46,
  rangeDb: 20,
  holdMs: 250,
  attackMs: 3,
  releaseMs: 300,
};

const NOISY_GATE: GateSettings = {
  thresholdDb: -40,
  rangeDb: 18,
  holdMs: 200,
  attackMs: 3,
  releaseMs: 250,
};

/**
 * Levels a noisy-room voice. With +8dB makeup the gain crosses 0dB at about
 * -10.7dBFS input, so anything louder is turned down, not up.
 */
const NOISY_COMPRESSOR: CompressorSettings = {
  thresholdDb: -24,
  ratio: 2.5,
  attackMs: 15,
  releaseMs: 350,
};

export const VOICE_STYLES: Record<VoiceStyle, VoiceStyleDef> = {
  open: {
    highpassHz: null,
    presence: null,
    dynamics: {
      gate: null,
      // Untouched below -20dBFS, where a quiet voice gets the full +8dB that
      // switching automatic gain off cost. Above it the lift tapers away and
      // reaches 0dB at -8dBFS, so a loud note is never pushed harder.
      compressor: { thresholdDb: -20, ratio: 3, attackMs: 10, releaseMs: 350 },
      makeupDb: 8,
      ceilingDb: CEILING_DB,
    },
  },
  "open-speakers": {
    highpassHz: null,
    presence: null,
    dynamics: {
      gate: SPEAKER_GATE,
      compressor: null,
      makeupDb: 0,
      ceilingDb: CEILING_DB,
    },
  },
  clean: {
    highpassHz: 90,
    presence: { frequencyHz: 3000, gainDb: 3, q: 0.9 },
    dynamics: {
      gate: NOISY_GATE,
      compressor: NOISY_COMPRESSOR,
      makeupDb: 8,
      ceilingDb: CEILING_DB,
    },
  },
  "clean-speakers": {
    highpassHz: 90,
    presence: null,
    dynamics: {
      gate: NOISY_GATE,
      compressor: NOISY_COMPRESSOR,
      makeupDb: 0,
      ceilingDb: CEILING_DB,
    },
  },
};

/** The shaping for where the song is playing and how loud the room is. */
export function voiceStyle(mode: AudioMode, noisy: boolean): VoiceStyle {
  if (mode === "headphones") return noisy ? "clean" : "open";
  return noisy ? "clean-speakers" : "open-speakers";
}
