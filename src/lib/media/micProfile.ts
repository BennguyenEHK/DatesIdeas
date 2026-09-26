/**
 * Microphone settings for talking, and for singing.
 *
 * The browser's default audio processing is built for speech. Noise
 * suppression treats a held note as steady noise and fades it, and automatic
 * gain pumps the level up and down across it -- so a singing voice arrives
 * thin, gated and broken on the high notes. Singing therefore never uses
 * either, in any room. Ordinary talking keeps both.
 *
 * Echo cancellation is the one that depends on the room, and the question it
 * answers is not "headphones or speakers?" but "can this microphone hear what
 * is playing?". A laptop's own microphone always can: a few centimetres from
 * its speakers, and close enough to hear headphones leak. Only a microphone
 * worn at the mouth, with the sound in the ears, cannot. Leaving cancellation
 * off for a laptop microphone under headphones is how the other person came to
 * hear their own voice with nobody on speakers at all.
 */
import {
  ECHO_SAFE_MAKEUP_GAIN_DB,
  MAKEUP_GAIN_DB,
  SPEAKER_MAKEUP_GAIN_DB,
} from "./micGain";
import {
  readMicSettings,
  unmetRequests,
  type MicSettings,
} from "./micState";

/**
 * The processing the browser exposes, plus the one the operating system does.
 *
 * `voiceIsolation` is not in the DOM types yet, but Chrome reads it and Windows
 * Studio Effects and its equivalents sit BELOW every other flag here. They are
 * built to keep a talking voice and discard everything else, and a held sung
 * note is exactly the kind of signal they are built to discard -- so asking for
 * a clean singing microphone without switching this off leaves the last, and
 * lowest, suppressor still running.
 *
 * A browser that has never heard of it ignores the extra property.
 */
type SingingConstraints = MediaTrackConstraints & { voiceIsolation?: boolean };

/**
 * The shape every singing profile asks the device for, whatever else it wants
 * switched on or off.
 *
 * One channel, because a microphone capsule has nothing to put in a second
 * one. The call sends mono Opus regardless, so asking for two only made the
 * browser upmix a signal it would immediately downmix again -- and echo
 * cancellation, which is built around a mono capture, had to cope with the
 * detour.
 *
 * 48000Hz, because that is the rate everything downstream already runs at:
 * Opus is a 48kHz codec and the browser renders audio at 48kHz. Left
 * unasked, a device offers its own preference -- 44100 on the machine these
 * reports come from -- and echo cancellation then has to compare a 44.1kHz
 * recording against a 48kHz playback, resampling one into the other and
 * chasing the drift between two crystals that will never quite agree. That is
 * a well-known way to make a canceller worse, and the person on speakers is
 * the one who pays for it.
 *
 * Both are `ideal`, never `exact`. A device that cannot oblige should hand
 * back what it has, exactly as it does today; refusing to open at all would
 * trade a slightly worse microphone for no microphone.
 */
const CAPTURE_SHAPE: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
};

/** How the song is reaching this person's ears, which decides what is safe. */
export type AudioMode = "headphones" | "speakers";

/**
 * Whether the microphone is worn at the mouth or sits out in the room.
 *
 * "open" is the safe answer, and the one given whenever a name does not say
 * otherwise: it only costs a canceller with little to cancel, where a wrong
 * "headset" sends the other person their own voice.
 */
export type MicKind = "headset" | "open";

const headsetMicWords =
  /\b(?:headsets?|hands[- ]?free|headphones?|earphones?|earbuds?|earpieces?|airpods?|buds\d*)\b/i;

/** Reads the microphone's kind from the name the browser gives it. */
export function classifyMic(label: string | null | undefined): MicKind {
  return label && headsetMicWords.test(label) ? "headset" : "open";
}

/** Ordinary conversation. Everything on, because everything helps speech. */
export const SPEECH_AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Singing into a headset microphone with the sound in the ears. Nothing reaches
 * the microphone but the voice, so every process can come off and the voice
 * arrives whole.
 */
export const HEADSET_AUDIO: SingingConstraints = {
  ...CAPTURE_SHAPE,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: false,
};

/**
 * Singing into a microphone that can hear what is playing: a laptop's own,
 * under headphones or beside its speakers. Echo cancellation STAYS ON -- it is
 * the only thing subtracting the other person's voice before it goes back to
 * them. Under headphones it has little to do and barely touches the singer.
 */
export const OPEN_MIC_AUDIO: SingingConstraints = {
  ...CAPTURE_SHAPE,
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: false,
};

/** What the device is asked for, and how much the boost stage may lift it. */
export interface SingingSetup {
  constraints: SingingConstraints;
  makeupDb: number;
}

/**
 * Chooses the singing microphone for how the song is heard and which
 * microphone is singing into it.
 *
 * The lift follows the echo risk. The full lift only when the microphone
 * cannot hear anything playing; a little under headphones, where it can hear a
 * leak; none of our own on speakers, where it hears everything.
 */
export function singingSetup(mode: AudioMode, mic: MicKind): SingingSetup {
  if (mode === "speakers") {
    return { constraints: OPEN_MIC_AUDIO, makeupDb: SPEAKER_MAKEUP_GAIN_DB };
  }
  return mic === "headset"
    ? { constraints: HEADSET_AUDIO, makeupDb: MAKEUP_GAIN_DB }
    : { constraints: OPEN_MIC_AUDIO, makeupDb: ECHO_SAFE_MAKEUP_GAIN_DB };
}

/**
 * What the retune was asked for, and what it actually got.
 *
 * The second half is the point. A resolved applyConstraints means the browser
 * considered the request, not that it granted it, and a device is free to
 * report success while changing nothing whatsoever.
 */
export interface TuneResult {
  requested: MediaTrackConstraints;
  /** What the first audio track settled on, or null when it cannot be read. */
  settings: MicSettings | null;
  /** Requested processing flags the device did not actually adopt. */
  unmet: string[];
  /** Why the device refused the constraints, or null when it did not. */
  error: string | null;
}

/**
 * Retunes the live microphone without renegotiating the call, and reports back
 * what actually happened to it.
 *
 * applyConstraints swaps the settings on the existing track, so the connection
 * is untouched and nothing drops. A refusal is still swallowed as far as the
 * CALL is concerned -- a microphone that stays tuned for speech is a
 * worse-sounding karaoke, not a broken evening -- but it is no longer swallowed
 * as far as the EVIDENCE is concerned, which is the distinction that used to be
 * missing. A profile that never applied and a profile that applied perfectly
 * produced identical, silent code paths, and they are completely different bugs.
 */
export async function tuneMicrophone(
  stream: MediaStream | null,
  mode: AudioMode | null,
  mic: MicKind = "open",
): Promise<TuneResult> {
  const requested =
    mode === null ? SPEECH_AUDIO : singingSetup(mode, mic).constraints;
  const empty: TuneResult = { requested, settings: null, unmet: [], error: null };
  if (!stream) return empty;

  const tracks = stream.getAudioTracks();
  let error: string | null = null;

  await Promise.all(
    tracks.map((track) =>
      track.applyConstraints(requested).catch((cause: unknown) => {
        error ??= cause instanceof Error ? cause.name : "refused";
      }),
    ),
  );

  // Read back from the first track: a machine with two microphones in the
  // stream is not a case this app creates, and the first one is the one being
  // sung into.
  const settings = tracks.length > 0 ? readMicSettings(tracks[0]) : null;
  return { requested, settings, unmet: unmetRequests(requested, settings), error };
}
