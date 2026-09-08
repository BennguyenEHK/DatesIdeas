/**
 * Microphone settings for talking, and for singing.
 *
 * The browser's default audio processing is built for speech. Noise
 * suppression treats sustained music as noise and ducks it, and automatic gain
 * pumps the level up and down across a held note — so a singing voice arrives
 * thin and gated. Turning them off is what makes quiet-room karaoke sound
 * like a person rather than a phone call. In a noisy room, noise suppression
 * and automatic gain keep the voice present over the room. Automatic gain
 * pumps across a held note, but that trade is accepted because a voice you can
 * hear beats a purer one buried under a room.
 *
 * How far the processing can come off depends on where the song is playing.
 * In headphones nothing but the voice reaches the microphone, so all of it can
 * go. On speakers, echo cancellation has to stay: it is the only thing
 * stopping the microphone sending back a second copy of the song, arriving a
 * fraction of a second behind the one already playing. That is why the app
 * asks which it is rather than assuming, and why answering wrongly is worse
 * than not answering at all.
 */
import {
  readMicSettings,
  unmetRequests,
  type MicSettings,
} from "./micState";

/** How the song is reaching this person's ears, which decides what is safe. */
export type AudioMode = "headphones" | "speakers";

/** Ordinary conversation. Everything on, because everything helps speech. */
export const SPEECH_AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Singing in headphones. Nothing reaches the microphone but the voice, so
 * every process can come off and the voice arrives whole.
 */
export const HEADPHONE_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * Singing on speakers. Echo cancellation STAYS ON — it is the only thing
 * subtracting the song from the microphone, and without it the partner hears
 * the same song twice, a fraction apart. The other two still come off, since
 * they are what thin and gate a singing voice.
 *
 * It will not sound as good as headphones. Cancellation is a prediction, and
 * a loud speaker distorts in ways it cannot predict, so some of the song
 * always gets through. The gap it closes is between "a bit of bleed" and
 * "unlistenable", which is worth having.
 */
export const SPEAKER_AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * Singing in headphones in a noisy room. Echo cancellation can stay off
 * because the song cannot reach the microphone, while noise suppression and
 * gain keep the voice above the room.
 */
export const HEADPHONE_NOISY_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Singing on speakers in a noisy room. Echo cancellation still has to stay on
 * to subtract the song, while noise suppression gives it a cleaner signal and
 * gain keeps the voice present over the room. Automatic gain pumps across a
 * held note, but a voice you can hear beats a purer one buried under a room.
 */
export const SPEAKER_NOISY_AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** Selects the singing profile for the listening mode and room noise. */
export function singingProfile(
  mode: AudioMode,
  noisy: boolean,
): MediaTrackConstraints {
  if (mode === "headphones") {
    return noisy ? HEADPHONE_NOISY_AUDIO : HEADPHONE_AUDIO;
  }
  return noisy ? SPEAKER_NOISY_AUDIO : SPEAKER_AUDIO;
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
  noisy = false,
): Promise<TuneResult> {
  const requested =
    mode === null ? SPEECH_AUDIO : singingProfile(mode, noisy);
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
