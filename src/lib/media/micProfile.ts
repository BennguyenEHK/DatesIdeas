/**
 * Microphone settings for talking, and for singing.
 *
 * The browser's default audio processing is built for speech. Noise
 * suppression treats sustained music as noise and ducks it, and automatic gain
 * pumps the level up and down across a held note — so a singing voice arrives
 * thin and gated. Turning them off is what makes karaoke sound like a person
 * rather than a phone call.
 *
 * How far the processing can come off depends on where the song is playing.
 * In headphones nothing but the voice reaches the microphone, so all of it can
 * go. On speakers, echo cancellation has to stay: it is the only thing
 * stopping the microphone sending back a second copy of the song, arriving a
 * fraction of a second behind the one already playing. That is why the app
 * asks which it is rather than assuming, and why answering wrongly is worse
 * than not answering at all.
 */
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
 * Retunes the live microphone without renegotiating the call.
 *
 * applyConstraints swaps the settings on the existing track, so the connection
 * is untouched and nothing drops. Failures are swallowed on purpose: not every
 * device honours every constraint, and a microphone that stays tuned for
 * speech is a worse-sounding karaoke, not a broken call.
 */
export async function tuneMicrophone(
  stream: MediaStream | null,
  mode: AudioMode | null,
): Promise<void> {
  if (!stream) return;
  const constraints =
    mode === "headphones"
      ? HEADPHONE_AUDIO
      : mode === "speakers"
        ? SPEAKER_AUDIO
        : SPEECH_AUDIO;
  await Promise.all(
    stream.getAudioTracks().map((track) =>
      track.applyConstraints(constraints).catch(() => {}),
    ),
  );
}
