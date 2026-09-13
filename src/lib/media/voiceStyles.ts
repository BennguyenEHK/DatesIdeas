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
 *   echo cancellation always leaves behind. While someone sings it is fully
 *   open, so a high note passes untouched.
 * - a gentle compressor, in a noisy room only, to keep the voice level steady.
 * - a fixed makeup gain, because automatic gain control is off.
 * - a limiter, so the makeup gain can never push a loud note into clipping.
 *
 * The old stage used the browser's DynamicsCompressorNode, which silently adds
 * its own makeup gain (about 5dB at the settings used). It lifted a quiet echo
 * residual by over 9dB on speakers -- more than the voice -- which is how the
 * other person came to hear themselves. The dynamics now run in an
 * AudioWorklet whose every decibel is written down below.
 */
import type { AudioMode } from "./micProfile";

/** Which shaping a singing microphone gets. */
export type VoiceStyle =
  /** Headphones, quiet room: the voice as captured, only louder and never clipped. */
  | "open"
  /** Speakers, quiet room: as captured, with a gate that shuts out the echo residual between phrases. */
  | "open-speakers"
  /** Noisy room, either output: rumble cut, voice presence lifted, room gated, level held steady. */
  | "clean";

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
  /** Fixed gain applied after gate and compressor. */
  makeupDb: number;
  /** The limiter's ceiling. No output sample may exceed this, ever. */
  ceilingDb: number;
}

export interface VoiceStyleDef {
  /** A 12dB/octave high-pass below the voice, or null for none. */
  highpassHz: number | null;
  /** A peaking lift where a voice cuts through a room, or null for none. */
  presence: { frequencyHz: number; gainDb: number; q: number } | null;
  dynamics: VoiceDynamicsSettings;
}

/** The name the worklet module registers its processor under. */
export const VOICE_PROCESSOR_NAME = "voice-dynamics";

/** Where the worklet module is served from (public/worklets/voice-dynamics.js). */
export const VOICE_WORKLET_URL = "/worklets/voice-dynamics.js";

/**
 * The makeup gain a capture without automatic gain control needs. Measured:
 * switching automatic gain off took a singing peak from 0.50 down to 0.10,
 * about 14dB, and ten of those come back here.
 */
const OPEN_MAKEUP_DB = 10;

/** Just under full scale, so encoders and resamplers downstream have a little room. */
const CEILING_DB = -1;

export const VOICE_STYLES: Record<VoiceStyle, VoiceStyleDef> = {
  open: {
    highpassHz: null,
    presence: null,
    dynamics: {
      gate: null,
      compressor: null,
      makeupDb: OPEN_MAKEUP_DB,
      ceilingDb: CEILING_DB,
    },
  },
  "open-speakers": {
    highpassHz: null,
    presence: null,
    dynamics: {
      // Soft singing sits well above -46dBFS; an echo residual sits below it.
      gate: {
        thresholdDb: -46,
        rangeDb: 20,
        holdMs: 250,
        attackMs: 3,
        releaseMs: 300,
      },
      compressor: null,
      // Less than headphones: whatever the gate lets through is lifted too.
      makeupDb: 6,
      ceilingDb: CEILING_DB,
    },
  },
  clean: {
    highpassHz: 90,
    presence: { frequencyHz: 3000, gainDb: 3, q: 0.9 },
    dynamics: {
      gate: {
        thresholdDb: -40,
        rangeDb: 18,
        holdMs: 200,
        attackMs: 3,
        releaseMs: 250,
      },
      compressor: {
        thresholdDb: -24,
        ratio: 2.5,
        attackMs: 15,
        releaseMs: 350,
      },
      makeupDb: 8,
      ceilingDb: CEILING_DB,
    },
  },
};

/** The shaping for where the song is playing and how loud the room is. */
export function voiceStyle(mode: AudioMode, noisy: boolean): VoiceStyle {
  if (noisy) return "clean";
  return mode === "headphones" ? "open" : "open-speakers";
}
